import 'dotenv/config';

import { mkdir, appendFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve } from 'node:path';
import knex from 'knex';
import config from '../config/index.js';

type TxType = 'income' | 'expense';

type TxRow = {
  id: string;
  user_id: string;
  type: TxType;
  amount: string;
  currency: string;
  category: string;
  description: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

type CategoryStat = { category: string; amount: number; percentage: number; count: number };
type MerchantStat = { merchant: string; amount: number; count: number };

type WeeklyReport = {
  report_id: string;
  generated_at: string;
  timezone: string;
  week: {
    from: string;
    to: string;
    previous_from: string;
    previous_to: string;
  };
  summary: {
    total_income: number;
    total_expenses: number;
    net_balance: number;
    analyzed_transaction_count: number;
  };
  spending_breakdown: {
    top_categories: CategoryStat[];
    top_merchants: MerchantStat[];
    percentage_by_category: CategoryStat[];
  };
  recurring_payments: Array<{ key: string; amount_avg: number; count: number }>;
  unusually_high_expenses: Array<{ id: string; amount: number; description: string; occurred_at: string }>;
  risks: string[];
  comparison_previous_week: {
    previous_income: number;
    previous_expenses: number;
    expense_change_pct: number | null;
    income_change_pct: number | null;
    notes: string[];
  };
  recommendations: {
    reduce_spending_areas: string[];
    suggested_savings_amount: number;
    next_week_discretionary_budget: number;
    caution_categories: string[];
    efficiency_tips: string[];
  };
  anomalies_detected: number;
};

type LogStats = {
  status: 'ok' | 'skipped' | 'error';
  duration_ms: number;
  analyzed_count: number;
  anomalies: number;
  delivery: string;
  parsing_failures: number;
};

const TZ = process.env.FIN_AUDIT_TZ || process.env.TZ || 'Asia/Jakarta';
const REPORT_DIR = resolve('/opt/agent-lfiathan/reports/weekly');
const LOG_DIR = resolve('/opt/agent-lfiathan/logs/weekly-audit');
const LOG_FILE = resolve(LOG_DIR, 'weekly-financial-audit.log');

const CATEGORY_RULES: Array<{ category: string; keywords: string[] }> = [
  { category: 'food_delivery', keywords: ['gofood', 'grabfood', 'shopee food', 'nasi', 'babat', 'wingstop', 'alfamart', 'coffee', 'makan', 'resto'] },
  { category: 'transport', keywords: ['gocar', 'grabcar', 'goride', 'toll', 'spbu', 'bensin', 'parkir', 'transport'] },
  { category: 'entertainment', keywords: ['netflix', 'spotify', 'steam', 'game', 'bioskop', 'entertainment', 'youtube premium'] },
  { category: 'subscription', keywords: ['subscription', 'langganan', 'auto debit', 'debit otomatis', 'monthly fee'] },
  { category: 'utilities', keywords: ['pln', 'listrik', 'air', 'telkom', 'internet', 'wifi'] },
  { category: 'shopping', keywords: ['shopee', 'tokopedia', 'lazada', 'tiktok shop', 'ecommerce', 'belanja'] },
  { category: 'cash_withdrawal', keywords: ['tarikan atm', 'cash withdrawal'] },
  { category: 'transfer', keywords: ['trsf e-banking', 'transfer', 'bi-fast', 'va', 'virtual account'] },
];

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function fmtDate(d: Date): string {
  return d.toISOString();
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function parseAmount(v: string): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function detectCategory(tx: TxRow): string {
  const desc = normalizeText(tx.description ?? '');
  const metadataText = normalizeText(JSON.stringify(tx.metadata ?? {}));
  const hay = `${desc} ${metadataText}`;
  for (const r of CATEGORY_RULES) {
    if (r.keywords.some((k) => hay.includes(k))) return r.category;
  }
  return tx.category || 'other';
}

function extractMerchant(tx: TxRow): string {
  const md = tx.metadata ?? {};
  const byMd = [md.merchant_vendor, md.merchant, md.sender].find((x) => typeof x === 'string' && x.trim().length > 1);
  if (byMd && typeof byMd === 'string') return byMd.trim().slice(0, 120);
  const d = (tx.description ?? '').trim();
  if (!d) return 'unknown';
  return d.split('-').pop()?.trim().slice(0, 120) || d.slice(0, 120);
}

function isMicro(amount: number): boolean {
  return amount > 0 && amount <= 50000;
}

function toMd(report: WeeklyReport): string {
  const c = report.comparison_previous_week;
  return `## Weekly Financial Summary\n\n- Periode: ${report.week.from} s/d ${report.week.to}\n- Total Income: Rp ${report.summary.total_income.toLocaleString('id-ID')}\n- Total Expenses: Rp ${report.summary.total_expenses.toLocaleString('id-ID')}\n- Net Balance: Rp ${report.summary.net_balance.toLocaleString('id-ID')}\n- Jumlah Transaksi Dianalisis: ${report.summary.analyzed_transaction_count}\n\n## Spending Breakdown\n\n### Top Spending Categories\n${report.spending_breakdown.top_categories.map((x) => `- ${x.category}: Rp ${x.amount.toLocaleString('id-ID')} (${x.percentage.toFixed(1)}%, ${x.count} trx)`).join('\n') || '- Tidak ada data'}\n\n### Top Merchants/Vendors\n${report.spending_breakdown.top_merchants.map((x) => `- ${x.merchant}: Rp ${x.amount.toLocaleString('id-ID')} (${x.count} trx)`).join('\n') || '- Tidak ada data'}\n\n## Largest Expenses\n${report.unusually_high_expenses.map((x) => `- ${x.occurred_at}: ${x.description} — Rp ${x.amount.toLocaleString('id-ID')}`).join('\n') || '- Tidak ada lonjakan biaya'}\n\n## Spending Warnings\n${report.risks.map((r) => `- ⚠️ ${r}`).join('\n') || '- Tidak ada warning kritikal minggu ini'}\n\n## Financial Health Insights\n- Perubahan expense WoW: ${c.expense_change_pct === null ? 'N/A' : `${c.expense_change_pct.toFixed(1)}%`}\n- Perubahan income WoW: ${c.income_change_pct === null ? 'N/A' : `${c.income_change_pct.toFixed(1)}%`}\n${c.notes.map((n) => `- ${n}`).join('\n')}\n\n## Recommendations for Next Week\n- Suggested Savings: Rp ${report.recommendations.suggested_savings_amount.toLocaleString('id-ID')}\n- Safe Discretionary Budget: Rp ${report.recommendations.next_week_discretionary_budget.toLocaleString('id-ID')}\n\n### Categories Requiring Caution\n${report.recommendations.caution_categories.map((x) => `- ${x}`).join('\n') || '- Tidak ada kategori high-risk'}\n\n### Savings Opportunities\n${report.recommendations.reduce_spending_areas.map((x) => `- ${x}`).join('\n') || '- Belanja sudah relatif efisien'}\n\n### Financial Efficiency Recommendations\n${report.recommendations.efficiency_tips.map((x) => `- ${x}`).join('\n')}\n`;
}

async function writeLog(event: string, payload: Record<string, unknown>): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), event, ...payload })}\n`, 'utf8');
}

async function main(): Promise<void> {
  const started = Date.now();
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

  const stats: LogStats = {
    status: 'ok',
    duration_ms: 0,
    analyzed_count: 0,
    anomalies: 0,
    delivery: 'stored_to_disk',
    parsing_failures: 0,
  };

  try {
    await mkdir(REPORT_DIR, { recursive: true });

    const now = new Date();
    const today = startOfLocalDay(now);
    const weekTo = endOfLocalDay(new Date(today.getTime() - 24 * 60 * 60 * 1000));
    const weekFrom = startOfLocalDay(new Date(weekTo.getTime() - 6 * 24 * 60 * 60 * 1000));
    const prevTo = endOfLocalDay(new Date(weekFrom.getTime() - 24 * 60 * 60 * 1000));
    const prevFrom = startOfLocalDay(new Date(prevTo.getTime() - 6 * 24 * 60 * 60 * 1000));

    const reportId = `weekly-${weekFrom.toISOString().slice(0, 10)}_${weekTo.toISOString().slice(0, 10)}`;
    const jsonPath = resolve(REPORT_DIR, `${reportId}.json`);
    const mdPath = resolve(REPORT_DIR, `${reportId}.md`);

    try {
      await access(jsonPath, fsConstants.F_OK);
      stats.status = 'skipped';
      stats.duration_ms = Date.now() - started;
      await writeLog('weekly_audit_skipped_duplicate', { report_id: reportId, ...stats });
      process.stdout.write(`${JSON.stringify({ status: 'skipped', reason: 'already_exists', report_id: reportId })}\n`);
      return;
    } catch {
      // continue
    }

    const txRows = (await db('transactions')
      .select('*')
      .whereBetween('occurred_at', [fmtDate(weekFrom), fmtDate(weekTo)])) as TxRow[];

    const prevRows = (await db('transactions')
      .select('*')
      .whereBetween('occurred_at', [fmtDate(prevFrom), fmtDate(prevTo)])) as TxRow[];

    stats.analyzed_count = txRows.length;

    const mapped = txRows.map((tx) => {
      const amount = parseAmount(tx.amount);
      const categoryDetected = detectCategory(tx);
      const merchant = extractMerchant(tx);
      if (!categoryDetected) stats.parsing_failures += 1;
      return { ...tx, amountNum: amount, categoryDetected, merchant };
    });

    const incomes = mapped.filter((x) => x.type === 'income');
    const expenses = mapped.filter((x) => x.type === 'expense');

    const totalIncome = incomes.reduce((a, b) => a + b.amountNum, 0);
    const totalExpenses = expenses.reduce((a, b) => a + b.amountNum, 0);
    const netBalance = totalIncome - totalExpenses;

    const catMap = new Map<string, { amount: number; count: number }>();
    for (const e of expenses) {
      const k = e.categoryDetected;
      const prev = catMap.get(k) ?? { amount: 0, count: 0 };
      prev.amount += e.amountNum;
      prev.count += 1;
      catMap.set(k, prev);
    }

    const categories = [...catMap.entries()]
      .map(([category, v]) => ({
        category,
        amount: v.amount,
        percentage: totalExpenses > 0 ? (v.amount / totalExpenses) * 100 : 0,
        count: v.count,
      }))
      .sort((a, b) => b.amount - a.amount);

    const merchantMap = new Map<string, { amount: number; count: number }>();
    for (const e of expenses) {
      const k = e.merchant;
      const prev = merchantMap.get(k) ?? { amount: 0, count: 0 };
      prev.amount += e.amountNum;
      prev.count += 1;
      merchantMap.set(k, prev);
    }

    const merchants = [...merchantMap.entries()]
      .map(([merchant, v]) => ({ merchant, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount);

    const expenseAmounts = expenses.map((x) => x.amountNum).sort((a, b) => a - b);
    const p95 = expenseAmounts.length === 0 ? 0 : expenseAmounts[Math.floor((expenseAmounts.length - 1) * 0.95)];
    const highExpenses = expenses
      .filter((x) => x.amountNum >= p95 && x.amountNum > 0)
      .sort((a, b) => b.amountNum - a.amountNum)
      .slice(0, 10)
      .map((x) => ({ id: x.id, amount: x.amountNum, description: x.description ?? '(no description)', occurred_at: x.occurred_at }));

    const recurringMap = new Map<string, number[]>();
    for (const e of expenses) {
      const key = `${e.merchant}|${e.categoryDetected}`;
      recurringMap.set(key, [...(recurringMap.get(key) ?? []), e.amountNum]);
    }
    const recurring = [...recurringMap.entries()]
      .filter(([, amounts]) => amounts.length >= 2)
      .map(([key, amounts]) => ({ key, amount_avg: amounts.reduce((a, b) => a + b, 0) / amounts.length, count: amounts.length }))
      .sort((a, b) => b.count - a.count);

    const prevIncome = prevRows.filter((x) => x.type === 'income').reduce((a, b) => a + parseAmount(b.amount), 0);
    const prevExpenses = prevRows.filter((x) => x.type === 'expense').reduce((a, b) => a + parseAmount(b.amount), 0);
    const expenseWoW = pctChange(totalExpenses, prevExpenses);
    const incomeWoW = pctChange(totalIncome, prevIncome);

    const risks: string[] = [];
    const notes: string[] = [];

    const food = categories.find((x) => x.category === 'food_delivery');
    if (food && food.percentage >= 30) risks.push(`Pengeluaran food delivery tinggi (${food.percentage.toFixed(1)}% dari total expense).`);

    const ent = categories.find((x) => x.category === 'entertainment');
    if (ent && ent.percentage >= 20) risks.push(`Belanja entertainment cenderung berlebihan (${ent.percentage.toFixed(1)}%).`);

    const microCount = expenses.filter((x) => isMicro(x.amountNum)).length;
    if (microCount >= 10) risks.push(`Terdapat ${microCount} microtransactions minggu ini; potensi spending bocor.`);

    const subs = categories.find((x) => x.category === 'subscription');
    if (subs && subs.count >= 3) risks.push(`Ada ${subs.count} pembayaran subscription; cek layanan yang tidak terpakai.`);

    if (expenseWoW !== null && expenseWoW > 25) risks.push(`Total pengeluaran naik ${expenseWoW.toFixed(1)}% dibanding minggu lalu.`);
    if (highExpenses.length >= 3) risks.push('Terdapat beberapa pengeluaran bernilai tinggi dalam waktu berdekatan.');

    if (expenseWoW !== null) {
      notes.push(expenseWoW > 0 ? `Expense naik ${expenseWoW.toFixed(1)}% WoW.` : `Expense turun ${Math.abs(expenseWoW).toFixed(1)}% WoW.`);
    } else {
      notes.push('Data minggu lalu belum cukup untuk menghitung perubahan expense.');
    }

    if (incomeWoW !== null) {
      notes.push(incomeWoW > 0 ? `Income naik ${incomeWoW.toFixed(1)}% WoW.` : `Income turun ${Math.abs(incomeWoW).toFixed(1)}% WoW.`);
    } else {
      notes.push('Data minggu lalu belum cukup untuk menghitung perubahan income.');
    }

    const reduceAreas = categories.slice(0, 3).map((c) => `Kurangi kategori ${c.category} sekitar 10-15% (saat ini Rp ${c.amount.toLocaleString('id-ID')}).`);
    const suggestedSavings = Math.max(0, Math.round((totalIncome > 0 ? totalIncome : totalExpenses) * 0.15));
    const safeBudget = Math.max(0, Math.round((totalIncome > 0 ? totalIncome * 0.3 : totalExpenses * 0.2)));

    const report: WeeklyReport = {
      report_id: reportId,
      generated_at: new Date().toISOString(),
      timezone: TZ,
      week: {
        from: weekFrom.toISOString(),
        to: weekTo.toISOString(),
        previous_from: prevFrom.toISOString(),
        previous_to: prevTo.toISOString(),
      },
      summary: {
        total_income: Math.round(totalIncome),
        total_expenses: Math.round(totalExpenses),
        net_balance: Math.round(netBalance),
        analyzed_transaction_count: txRows.length,
      },
      spending_breakdown: {
        top_categories: categories.slice(0, 5),
        top_merchants: merchants.slice(0, 5),
        percentage_by_category: categories,
      },
      recurring_payments: recurring.slice(0, 10),
      unusually_high_expenses: highExpenses,
      risks,
      comparison_previous_week: {
        previous_income: Math.round(prevIncome),
        previous_expenses: Math.round(prevExpenses),
        expense_change_pct: expenseWoW,
        income_change_pct: incomeWoW,
        notes,
      },
      recommendations: {
        reduce_spending_areas: reduceAreas,
        suggested_savings_amount: suggestedSavings,
        next_week_discretionary_budget: safeBudget,
        caution_categories: categories.filter((x) => x.percentage >= 20).map((x) => x.category),
        efficiency_tips: [
          'Gunakan limit mingguan per kategori untuk menahan belanja impulsif.',
          'Gabungkan transaksi kecil agar mengurangi micro-spending leak.',
          'Tinjau subscription dan matikan layanan yang jarang dipakai.',
        ],
      },
      anomalies_detected: risks.length + highExpenses.length,
    };

    const markdown = toMd(report);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(mdPath, `${markdown}\n`, 'utf8');

    stats.anomalies = report.anomalies_detected;
    stats.duration_ms = Date.now() - started;

    await writeLog('weekly_audit_completed', {
      report_id: reportId,
      json_path: jsonPath,
      md_path: mdPath,
      ...stats,
    });

    process.stdout.write(`${JSON.stringify({ status: 'ok', report_id: reportId, json_path: jsonPath, md_path: mdPath, analyzed: txRows.length })}\n`);
  } catch (err) {
    stats.status = 'error';
    stats.duration_ms = Date.now() - started;
    await writeLog('weekly_audit_failed', {
      ...stats,
      error: err instanceof Error ? err.message : String(err),
    });
    process.stderr.write(`weekly financial audit failed: ${String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

void main();
