import 'dotenv/config';

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

type Candidate = {
  parsed?: {
    amount?: number;
    currency?: string;
    inferredType?: 'income' | 'expense' | string;
    subject?: string;
    gmailDateRaw?: string;
  };
};

type PendingFile = {
  runId?: string;
  generatedAt?: string;
  stats?: {
    processedEmailCount?: number;
    insertedTransactionCount?: number;
    stagedForApprovalCount?: number;
    skippedDuplicates?: number;
    parsingFailures?: number;
    authIssues?: number;
    fetchFailures?: number;
  };
  candidates?: Candidate[];
};

const BASE_DIR = resolve(process.env.TX_EMAIL_IMPORT_LOG_DIR ?? '/opt/agent-lfiathan/logs/email-import');
const PENDING_DIR = resolve(BASE_DIR, 'pending-approvals');
const REVIEW_DIR = resolve(BASE_DIR, 'review-reports');
const TZ = process.env.TZ ?? 'Asia/Jakarta';

async function latestJsonFile(dir: string): Promise<string | null> {
  const names = (await readdir(dir)).filter((f) => f.endsWith('.processed.json') || f.endsWith('.approved.json'));
  if (!names.length) return null;
  const stats = await Promise.all(names.map(async (name) => ({
    name,
    mtime: (await (await import('node:fs/promises')).stat(resolve(dir, name))).mtimeMs,
  })));
  stats.sort((a, b) => b.mtime - a.mtime);
  return resolve(dir, stats[0].name);
}

function fmtWib(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d) + ' WIB';
}

async function main(): Promise<void> {
  await mkdir(REVIEW_DIR, { recursive: true });

  const latest = await latestJsonFile(PENDING_DIR);
  if (!latest) {
    const msg = { status: 'ok', message: 'No pending-approval JSON found', reviewReport: null };
    process.stdout.write(`${JSON.stringify(msg)}\n`);
    return;
  }

  const raw = await readFile(latest, 'utf8');
  const payload = JSON.parse(raw) as PendingFile;
  const candidates = payload.candidates ?? [];

  let incomeCount = 0;
  let expenseCount = 0;
  let incomeTotal = 0;
  let expenseTotal = 0;

  for (const c of candidates) {
    const amount = Number(c.parsed?.amount ?? 0);
    const kind = c.parsed?.inferredType;
    if (kind === 'income') {
      incomeCount += 1;
      incomeTotal += Number.isFinite(amount) ? amount : 0;
    } else {
      expenseCount += 1;
      expenseTotal += Number.isFinite(amount) ? amount : 0;
    }
  }

  const lines: string[] = [];
  lines.push('# Daily Transaction Import Review (WIB)');
  lines.push('');
  lines.push(`- Source file: ${basename(latest)}`);
  lines.push(`- Run ID: ${payload.runId ?? '-'}`);
  lines.push(`- Generated (WIB): ${fmtWib(payload.generatedAt)}`);
  lines.push('');
  lines.push('## Stats');
  lines.push(`- Processed emails: ${payload.stats?.processedEmailCount ?? 0}`);
  lines.push(`- Inserted transactions: ${payload.stats?.insertedTransactionCount ?? 0}`);
  lines.push(`- Staged for approval: ${payload.stats?.stagedForApprovalCount ?? 0}`);
  lines.push(`- Skipped duplicates: ${payload.stats?.skippedDuplicates ?? 0}`);
  lines.push(`- Parsing failures: ${payload.stats?.parsingFailures ?? 0}`);
  lines.push(`- Auth issues: ${payload.stats?.authIssues ?? 0}`);
  lines.push(`- Fetch failures: ${payload.stats?.fetchFailures ?? 0}`);
  lines.push('');
  lines.push('## Candidate Summary');
  lines.push(`- Candidate count: ${candidates.length}`);
  lines.push(`- Expense candidates: ${expenseCount} (total ~ ${expenseTotal.toFixed(2)} IDR)`);
  lines.push(`- Income candidates: ${incomeCount} (total ~ ${incomeTotal.toFixed(2)} IDR)`);

  const outName = `${payload.runId ?? new Date().toISOString().replace(/[:.]/g, '-')}.review.md`;
  const outPath = resolve(REVIEW_DIR, outName);
  await writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({ status: 'ok', source: latest, reviewReport: outPath })}\n`);
}

void main().catch((err) => {
  process.stderr.write(`transaction-email-review failed: ${String(err)}\n`);
  process.exit(1);
});
