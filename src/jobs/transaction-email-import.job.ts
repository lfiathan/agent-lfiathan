import 'dotenv/config';

import { createHash } from 'node:crypto';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import knex from 'knex';
import config from '../config/index.js';
import { fetchRecentMessages, type GmailMessage } from '../services/gmail-imap.service.js';
import { extractTransactionFields, isLlmExtractConfigured } from '../services/llm-extract.service.js';

type TxType = 'income' | 'expense';

/** An email that must not go straight into the ledger, staged for approval. */
type Candidate = {
  messageId: string;
  source: 'llm-fallback' | 'untrusted-sender';
  parsed: {
    amount: number;
    currency: string;
    inferredType: TxType;
    subject: string;
    gmailDateRaw?: string;
  };
  from: string | null;
  referenceNumber: string | null;
  merchantVendor: string | null;
  confidence: number;
};

type ParsedTransaction = {
  sender: string | null;
  subject: string;
  amount: number | null;
  currency: string | null;
  transactionDate: string | null;
  referenceNumber: string | null;
  paymentMethod: string | null;
  merchantVendor: string | null;
  rawEmailContent: string;
  inferredType: TxType;
  category: string;
};

type RunStats = {
  processedEmailCount: number;
  insertedTransactionCount: number;
  stagedForApprovalCount: number;
  skippedDuplicates: number;
  parsingFailures: number;
  /** Separate from parsingFailures: the email parsed, the user did not resolve. */
  unresolvedUsers: number;
  authIssues: number;
  fetchFailures: number;
};

const SOURCE_SYSTEM = 'gmail';
const MAX_EMAILS_PER_RUN = Number.parseInt(process.env.TX_EMAIL_IMPORT_MAX_EMAILS ?? '200', 10);
const LOOKBACK_DAYS = Number.parseInt(process.env.TX_EMAIL_IMPORT_LOOKBACK_DAYS ?? '1', 10);
const LOG_DIR = resolve(process.env.TX_EMAIL_IMPORT_LOG_DIR ?? '/opt/agent-lfiathan/logs/email-import');
const LOG_FILE = resolve(LOG_DIR, 'transaction-email-import.log');
const PENDING_DIR = resolve(LOG_DIR, 'pending-approvals');
const IMAP_USER = process.env.GMAIL_IMAP_USER ?? process.env.TX_EMAIL_IMPORT_USER_EMAIL ?? '';
const IMAP_PASSWORD = process.env.GMAIL_IMAP_APP_PASSWORD ?? '';

/**
 * Only mail from these domains is written straight to the ledger.
 *
 * Sender turned out to be the strongest quality signal by a wide margin. Bank
 * notifications state one amount for one transaction. Marketing mail from
 * e-commerce does not: a voucher blast parsed as Rp4 income, a monthly spend
 * recap as Rp248.93 income, and "order shipped" plus "order received" for a
 * single purchase produced two rows with different Message-IDs, so the
 * fingerprint could not collapse them. Everything outside this list is staged
 * for approval instead of inserted.
 */
const TRUSTED_SENDER_DOMAINS = (process.env.TX_EMAIL_IMPORT_TRUSTED_SENDERS
  ?? 'bca.co.id,bankmandiri.co.id,bni.co.id,bri.co.id,permatabank.com')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function isTrustedSender(sender: string | null): boolean {
  const address = parseEmailAddress(sender ?? undefined);
  if (!address) return false;
  const domain = address.split('@')[1] ?? '';
  // Suffix match so notification.bca.co.id counts, but notbca.co.id does not.
  return TRUSTED_SENDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

const TRANSACTION_KEYWORDS = [
  'transaction', 'transaksi', 'payment', 'pembayaran', 'invoice', 'receipt',
  'paid', 'tagihan', 'billing', 'purchase', 'order', 'debit', 'credit', 'transfer',
  'refund', 'withdrawal', 'top up', 'topup', 'e-wallet', 'wallet', 'va', 'virtual account',
];

const EXPENSE_HINTS = [
  'payment', 'pembayaran', 'debit', 'purchase', 'paid to', 'you paid', 'tagihan', 'invoice',
  'qris', 'decrease', 'berhasil dibayar',
];

const INCOME_HINTS = [
  'credited', 'credit', 'received', 'refund', 'cashback', 'incoming', 'deposit',
  'masuk', 'diterima', 'top up berhasil',
];

const CURRENCY_REGEX = /(IDR|Rp\.?|USD|EUR|SGD|JPY|GBP)\s*([0-9][0-9.,\s]{0,30})|([0-9][0-9.,\s]{0,30})\s*(IDR|USD|EUR|SGD|JPY|GBP)/i;
const REFERENCE_REGEX = /(?:reference|ref(?:erence)?(?:\s*no)?|invoice(?:\s*no)?|receipt(?:\s*no)?|trx(?:\s*id)?|transaction(?:\s*id)?|nomor\s*referensi|no\.?\s*ref)\s*[:#-]?\s*([A-Z0-9\-]{4,})/i;
const PAYMENT_METHOD_REGEX = /(?:payment\s*method|metode\s*pembayaran|paid\s*via|via)\s*[:#-]?\s*([A-Za-z0-9\-\s]{3,40})/i;
const MERCHANT_REGEX = /(?:merchant|vendor|to|kepada|at)\s*[:#-]?\s*([A-Za-z0-9.&\-\s]{3,80})/i;

async function retry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 1000): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
  throw lastErr;
}

function normalizeCurrency(raw: string | null): string {
  if (!raw) return 'IDR';
  const upper = raw.toUpperCase().replace('.', '').trim();
  if (upper === 'RP') return 'IDR';
  return upper;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '');
  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;

  let normalized = cleaned;
  if (commaCount > 0 && dotCount > 0) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (commaCount > 0 && dotCount === 0) {
    const decimalLike = /,\d{1,2}$/.test(cleaned);
    normalized = decimalLike ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else {
    normalized = cleaned;
  }

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function normalizeDate(dateRaw: string | undefined, fallbackIso: string): string {
  if (!dateRaw) return fallbackIso;
  const parsed = new Date(dateRaw);
  if (Number.isNaN(parsed.getTime())) return fallbackIso;
  return parsed.toISOString();
}

/**
 * Keywords must match whole words.
 *
 * A plain substring test flags every Strava notification as a transaction,
 * because "va" — the Indonesian banking abbreviation for virtual account —
 * appears inside "Strava". It also hits "available", "private" and
 * "advantage". As a standalone word the keyword is fine; as a substring it
 * swamps the importer with false positives.
 */
const TRANSACTION_KEYWORD_REGEX = new RegExp(
  `\\b(${TRANSACTION_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i'
);

function containsTransactionKeyword(text: string): boolean {
  return TRANSACTION_KEYWORD_REGEX.test(text);
}

function inferType(text: string): TxType {
  const lower = text.toLowerCase();
  if (INCOME_HINTS.some((k) => lower.includes(k))) return 'income';
  if (EXPENSE_HINTS.some((k) => lower.includes(k))) return 'expense';
  return 'expense';
}

function parseTransaction(message: GmailMessage): ParsedTransaction | null {
  const subject = (message.subject ?? '').trim();
  const body = (message.body ?? '').trim();
  const haystack = `${subject}\n${body}`;

  if (!containsTransactionKeyword(haystack)) return null;

  const amountMatch = haystack.match(CURRENCY_REGEX);
  const referenceMatch = haystack.match(REFERENCE_REGEX);
  const methodMatch = haystack.match(PAYMENT_METHOD_REGEX);
  const merchantMatch = haystack.match(MERCHANT_REGEX);

  let currency: string | null = null;
  let amountRaw = '';
  if (amountMatch) {
    currency = amountMatch[1] || amountMatch[4] || null;
    amountRaw = amountMatch[2] || amountMatch[3] || '';
  }

  const amount = amountRaw ? parseAmount(amountRaw) : null;
  const transactionDate = normalizeDate(message.date, new Date().toISOString());

  return {
    sender: message.from?.trim() || null,
    subject,
    amount,
    currency: normalizeCurrency(currency),
    transactionDate,
    referenceNumber: referenceMatch?.[1] ?? null,
    paymentMethod: methodMatch?.[1]?.trim() ?? null,
    merchantVendor: merchantMatch?.[1]?.trim() ?? null,
    rawEmailContent: body,
    inferredType: inferType(haystack),
    category: 'email-import',
  };
}

function makeFingerprint(account: string, messageId: string, parsed: ParsedTransaction): string {
  const payload = [
    SOURCE_SYSTEM,
    account,
    messageId,
    parsed.amount ?? '',
    parsed.currency ?? '',
    parsed.transactionDate ?? '',
    parsed.referenceNumber ?? '',
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Pull recent mail over IMAP.
 *
 * The old Gmail-API path filtered by keyword server-side. IMAP has no
 * equivalent worth the complexity, so the window is narrowed by date here and
 * parseTransaction() applies TRANSACTION_KEYWORDS to whatever comes back —
 * the same list the server query used.
 */
async function fetchGmailMessages(): Promise<GmailMessage[]> {
  if (!IMAP_USER || !IMAP_PASSWORD) {
    throw new Error(
      'GMAIL_IMAP_USER and GMAIL_IMAP_APP_PASSWORD must be set (Google app password, not the account password)'
    );
  }

  return retry(
    () => fetchRecentMessages(
      { user: IMAP_USER, password: IMAP_PASSWORD },
      { sinceDays: LOOKBACK_DAYS, max: MAX_EMAILS_PER_RUN }
    ),
    3,
    1200
  );
}

/**
 * Persist candidates where transaction-email-review.job.ts looks for them.
 * That job only considers files ending in .processed.json or .approved.json.
 */
async function writePendingApprovals(
  runId: string,
  stats: RunStats,
  candidates: Candidate[]
): Promise<string | null> {
  if (!candidates.length) return null;

  await mkdir(PENDING_DIR, { recursive: true });
  const outPath = resolve(PENDING_DIR, `${runId}.processed.json`);
  await writeFile(
    outPath,
    `${JSON.stringify({ runId, generatedAt: new Date().toISOString(), stats, candidates }, null, 2)}\n`,
    { encoding: 'utf8' }
  );
  return outPath;
}

function parseEmailAddress(raw: string | undefined): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const addr = angle?.[1] ?? raw;
  const cleaned = addr.trim().toLowerCase();
  return cleaned.includes('@') ? cleaned : null;
}

async function resolveTargetUserId(db: ReturnType<typeof knex>, msg: GmailMessage): Promise<string | null> {
  const byEnvId = process.env.TX_EMAIL_IMPORT_USER_ID?.trim();
  if (byEnvId) return byEnvId;

  const byEnvEmail = process.env.TX_EMAIL_IMPORT_USER_EMAIL?.trim().toLowerCase();
  if (byEnvEmail) {
    const row = await db('users').whereRaw('LOWER(email) = ?', [byEnvEmail]).first();
    if (row?.id) return row.id as string;
  }

  const candidates = [parseEmailAddress(msg.to), parseEmailAddress(msg.from)].filter(Boolean) as string[];
  for (const email of candidates) {
    const row = await db('users').whereRaw('LOWER(email) = ?', [email]).first();
    if (row?.id) return row.id as string;
  }

  const users = await db('users').select('id').limit(2);
  if (users.length === 1) return users[0].id as string;
  return null;
}

async function writeLog(event: string, payload: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(LOG_FILE), { recursive: true });
  const row = JSON.stringify({ ts: new Date().toISOString(), event, ...payload });
  await appendFile(LOG_FILE, `${row}\n`, { encoding: 'utf8' });
}

async function main(): Promise<void> {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const candidates: Candidate[] = [];

  const stats: RunStats = {
    processedEmailCount: 0,
    insertedTransactionCount: 0,
    stagedForApprovalCount: 0,
    skippedDuplicates: 0,
    parsingFailures: 0,
    unresolvedUsers: 0,
    authIssues: 0,
    fetchFailures: 0,
  };

  const db = knex({
    client: 'pg',
    connection: {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
    },
    pool: config.database.pool,
  });

  try {
    await mkdir(LOG_DIR, { recursive: true });
    await writeLog('run_started', { maxEmails: MAX_EMAILS_PER_RUN });

    let messages: GmailMessage[] = [];
    try {
      messages = await fetchGmailMessages();
    } catch (err) {
      stats.authIssues += 1;
      await writeLog('auth_or_fetch_error', { error: String(err) });
      throw err;
    }

    for (const msg of messages) {
      stats.processedEmailCount += 1;
      const parsed = parseTransaction(msg);
      if (!parsed) continue;

      if (!parsed.amount || !parsed.currency) {
        // The rule-based parser could not read this one. Hand the already
        // fetched text to a single LLM pass and stage the result for approval.
        // It is never inserted directly: the call is non-deterministic, and
        // source_fingerprint only guarantees exactly-once when the parse
        // feeding it is reproducible.
        const extracted = isLlmExtractConfigured()
          ? await extractTransactionFields({
            subject: parsed.subject,
            from: parsed.sender,
            body: parsed.rawEmailContent,
          })
          : null;

        if (extracted && extracted.confidence > 0) {
          candidates.push({
            messageId: msg.id,
            source: 'llm-fallback',
            parsed: {
              amount: extracted.amount,
              currency: extracted.currency,
              inferredType: extracted.inferredType,
              subject: parsed.subject,
              gmailDateRaw: msg.date,
            },
            from: parsed.sender,
            referenceNumber: extracted.referenceNumber,
            merchantVendor: extracted.merchantVendor,
            confidence: extracted.confidence,
          });
          stats.stagedForApprovalCount += 1;
          await writeLog('staged_for_approval', {
            messageId: msg.id,
            subject: parsed.subject,
            confidence: extracted.confidence,
          });
          continue;
        }

        stats.parsingFailures += 1;
        await writeLog('parse_failed', { messageId: msg.id, subject: msg.subject ?? '' });
        continue;
      }

      if (!isTrustedSender(parsed.sender)) {
        // Read cleanly, but not by a bank. A confident number from marketing
        // mail is the failure mode that actually corrupts the ledger, so this
        // is staged for approval rather than inserted. When an LLM is
        // configured its verdict is preferred, since it can recognise a
        // promotion or a monthly summary that the regexes cannot.
        const verdict = isLlmExtractConfigured()
          ? await extractTransactionFields({
            subject: parsed.subject,
            from: parsed.sender,
            body: parsed.rawEmailContent,
          })
          : null;

        candidates.push({
          messageId: msg.id,
          source: 'untrusted-sender',
          parsed: {
            amount: verdict?.amount ?? parsed.amount,
            currency: verdict?.currency ?? parsed.currency,
            inferredType: verdict?.inferredType ?? parsed.inferredType,
            subject: parsed.subject,
            gmailDateRaw: msg.date,
          },
          from: parsed.sender,
          referenceNumber: verdict?.referenceNumber ?? parsed.referenceNumber,
          merchantVendor: verdict?.merchantVendor ?? parsed.merchantVendor,
          confidence: verdict?.confidence ?? 0,
        });
        stats.stagedForApprovalCount += 1;
        await writeLog('staged_untrusted_sender', {
          messageId: msg.id,
          subject: parsed.subject,
          from: parsed.sender,
          llmConfidence: verdict?.confidence ?? null,
        });
        continue;
      }

      const userId = await resolveTargetUserId(db, msg);
      if (!userId) {
        stats.unresolvedUsers += 1;
        await writeLog('user_resolution_failed', { messageId: msg.id, to: msg.to ?? null });
        continue;
      }

      const account = parseEmailAddress(msg.to) ?? parseEmailAddress(msg.from) ?? 'unknown';
      const fingerprint = makeFingerprint(account, msg.id, parsed);

      const dup = await db('transactions').where({ source_fingerprint: fingerprint }).first('id');
      if (dup) {
        stats.skippedDuplicates += 1;
        continue;
      }

      await db('transactions').insert({
        user_id: userId,
        type: parsed.inferredType,
        amount: parsed.amount,
        currency: parsed.currency,
        category: parsed.category,
        description: parsed.subject.slice(0, 5000) || null,
        occurred_at: parsed.transactionDate,
        metadata: {
          sender: parsed.sender,
          subject: parsed.subject,
          transaction_amount: parsed.amount,
          currency: parsed.currency,
          transaction_date: parsed.transactionDate,
          reference_number: parsed.referenceNumber,
          payment_method: parsed.paymentMethod,
          merchant_vendor: parsed.merchantVendor,
          raw_email_content: parsed.rawEmailContent,
          source_message_id: msg.id,
          source_thread_id: msg.threadId ?? null,
        },
        source_system: SOURCE_SYSTEM,
        source_account: account,
        source_message_id: msg.id,
        source_fingerprint: fingerprint,
      });

      stats.insertedTransactionCount += 1;
    }

    const pendingFile = await writePendingApprovals(runId, stats, candidates);
    if (pendingFile) await writeLog('staged_file_written', { runId, pendingFile });

    await writeLog('run_completed', { ...stats, runId } as unknown as Record<string, unknown>);
    process.stdout.write(`${JSON.stringify({ status: 'ok', runId, pendingFile, ...stats })}\n`);
  } catch (err) {
    await writeLog('run_failed', {
      ...stats,
      error: err instanceof Error ? err.message : String(err),
    });
    process.stderr.write(`Transaction email import failed: ${String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

void main();
