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

export class TransactionRepository {
  constructor(private readonly knex: Knex) {}

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
