import 'dotenv/config';

import { createHash } from 'node:crypto';
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import knex from 'knex';
import config from '../config/index.js';

type TxType = 'income' | 'expense';

type GmailEnvelope = {
  id: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
};

type GmailMessage = GmailEnvelope & {
  body?: string;
  threadId?: string;
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
  skippedDuplicates: number;
  parsingFailures: number;
  authIssues: number;
  fetchFailures: number;
};

const execFile = promisify(execFileCb);
const SOURCE_SYSTEM = 'gmail';
const MAX_EMAILS_PER_RUN = Number.parseInt(process.env.TX_EMAIL_IMPORT_MAX_EMAILS ?? '200', 10);
const LOG_DIR = resolve(process.env.TX_EMAIL_IMPORT_LOG_DIR ?? '/opt/agent-lfiathan/logs/email-import');
const LOG_FILE = resolve(LOG_DIR, 'transaction-email-import.log');
const PYTHON_BIN = process.env.PYTHON_BIN ?? 'python3';
const GAPI_SCRIPT =
  process.env.GOOGLE_API_SCRIPT ??
  '/root/.hermes/skills/productivity/google-workspace/scripts/google_api.py';

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

function containsTransactionKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return TRANSACTION_KEYWORDS.some((k) => lower.includes(k));
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

async function runGapi(args: string[]): Promise<string> {
  const { stdout } = await retry(() => execFile(PYTHON_BIN, [GAPI_SCRIPT, ...args], {
    env: process.env,
    maxBuffer: 1024 * 1024 * 8,
  }), 3, 1200);
  return stdout;
}

async function fetchGmailMessages(): Promise<GmailMessage[]> {
  const query = [
    '(transaction OR transaksi OR pembayaran OR payment OR invoice OR receipt OR billed OR debit OR credit OR transfer)',
    'newer_than:2d',
  ].join(' ');

  const searchRaw = await runGapi(['gmail', 'search', query, '--max', String(MAX_EMAILS_PER_RUN)]);
  const envelopes = JSON.parse(searchRaw) as GmailEnvelope[];

  const messages: GmailMessage[] = [];
  for (const env of envelopes) {
    if (!env.id) continue;
    try {
      const raw = await runGapi(['gmail', 'get', env.id]);
      messages.push(JSON.parse(raw) as GmailMessage);
    } catch {
      // handled in caller with fetch failure increment
    }
  }

  return messages;
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
  const stats: RunStats = {
    processedEmailCount: 0,
    insertedTransactionCount: 0,
    skippedDuplicates: 0,
    parsingFailures: 0,
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
        stats.parsingFailures += 1;
        await writeLog('parse_failed', { messageId: msg.id, subject: msg.subject ?? '' });
        continue;
      }

      const userId = await resolveTargetUserId(db, msg);
      if (!userId) {
        stats.parsingFailures += 1;
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

    await writeLog('run_completed', stats as unknown as Record<string, unknown>);
    process.stdout.write(`${JSON.stringify({ status: 'ok', ...stats })}\n`);
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
