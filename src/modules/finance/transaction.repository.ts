import type { Knex } from 'knex';
import type { TransactionType } from './transaction.schema.js';

const TABLE = 'transactions';

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: string; // pg numeric → string
  currency: string;
  category: string;
  description: string | null;
  occurred_at: Date;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTransactionDTO {
  user_id: string;
  type: TransactionType;
  amount: number;
  currency?: string;
  category: string;
  description?: string | null;
  occurred_at?: string | Date;
  metadata?: Record<string, unknown>;
}

export interface UpdateTransactionDTO {
  type?: TransactionType;
  amount?: number;
  currency?: string;
  category?: string;
  description?: string | null;
  occurred_at?: string | Date;
  metadata?: Record<string, unknown>;
}

export interface ListFilters {
  type?: TransactionType;
  from?: string | Date;
  to?: string | Date;
  limit?: number;
}

export interface SummaryFilters {
  from?: string | Date;
  to?: string | Date;
  currency?: string;
}

export interface SummaryRow {
  type: TransactionType;
  currency: string;
  total: string;
  count: string;
}

export interface BalanceResult {
  anchoredAt: string | null;
  anchorTotal: string;
  incomeSinceAnchor: string;
  expenseSinceAnchor: string;
  balance: string;
  currency: string;
}

export class TransactionRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Spendable balance, counted forward from a self-reported anchor.
   *
   * Summing the whole ledger gives a large negative number that means nothing:
   * it records outflows that arrive by email, while the income — mostly family
   * transfers — sends no email at all. Sixty days of mail produced 134 expense
   * rows and one income row.
   *
   * So balance is only defined from the most recent `saldo-awal` row onward.
   * Transfers are excluded because they move money between the owner's own
   * accounts rather than changing what he holds.
   *
   * Returns anchoredAt null when no anchor exists — the caller must say the
   * balance is unknown rather than fall back to summing everything.
   */
  async balanceForUser(userId: string, currency = 'IDR'): Promise<BalanceResult> {
    const anchor = await this.knex(TABLE)
      .where({ user_id: userId, category: 'saldo-awal', currency })
      .max<{ at: Date | null }>({ at: 'occurred_at' })
      .first();

    const anchoredAt = anchor?.at ? new Date(anchor.at).toISOString() : null;

    const zero = { anchoredAt: null, anchorTotal: '0', incomeSinceAnchor: '0', expenseSinceAnchor: '0', balance: '0', currency };
    if (!anchoredAt) return zero;

    const rows = await this.knex(TABLE)
      .where({ user_id: userId, currency })
      .andWhere('occurred_at', '>=', anchoredAt)
      .whereNot({ type: 'transfer' })
      .select('type')
      .sum<{ total: string }>({ total: 'amount' })
      .groupBy('type') as unknown as Array<{ type: string; total: string }>;

    const anchorRow = await this.knex(TABLE)
      .where({ user_id: userId, category: 'saldo-awal', currency })
      .sum<{ total: string }>({ total: 'amount' })
      .first();

    const income = Number(rows.find((r) => r.type === 'income')?.total ?? 0);
    const expense = Number(rows.find((r) => r.type === 'expense')?.total ?? 0);

    return {
      anchoredAt,
      anchorTotal: String(anchorRow?.total ?? 0),
      incomeSinceAnchor: String(income),
      expenseSinceAnchor: String(expense),
      balance: String(income - expense),
      currency,
    };
  }

  async findById(id: string): Promise<Transaction | undefined> {
    return this.knex(TABLE).where({ id }).first();
  }

  async findByUserId(userId: string, filters: ListFilters = {}): Promise<Transaction[]> {
    const query = this.knex(TABLE).where({ user_id: userId });
    if (filters.type) query.andWhere({ type: filters.type });
    if (filters.from) query.andWhere('occurred_at', '>=', filters.from);
    if (filters.to) query.andWhere('occurred_at', '<=', filters.to);
    return query.orderBy('occurred_at', 'desc').limit(filters.limit ?? 100);
  }

  async create(data: CreateTransactionDTO): Promise<Transaction> {
    const [row] = await this.knex(TABLE).insert(data).returning('*');
    return row;
  }

  async update(id: string, data: UpdateTransactionDTO): Promise<Transaction | undefined> {
    const [row] = await this.knex(TABLE)
      .where({ id })
      .update({ ...data, updated_at: this.knex.fn.now() })
      .returning('*');
    return row;
  }

  async delete(id: string): Promise<number> {
    return this.knex(TABLE).where({ id }).del();
  }

  async summarizeByUser(userId: string, filters: SummaryFilters = {}): Promise<SummaryRow[]> {
    const query = this.knex(TABLE)
      .where({ user_id: userId })
      .select('type', 'currency')
      .sum<{ total: string }>({ total: 'amount' })
      .count<{ count: string }>({ count: '*' })
      .groupBy('type', 'currency');

    if (filters.from) query.andWhere('occurred_at', '>=', filters.from);
    if (filters.to) query.andWhere('occurred_at', '<=', filters.to);
    if (filters.currency) query.andWhere({ currency: filters.currency });

    return query as unknown as Promise<SummaryRow[]>;
  }
}
