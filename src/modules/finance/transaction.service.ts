import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import {
  TransactionRepository,
  type Transaction,
  type CreateTransactionDTO,
  type UpdateTransactionDTO,
  type ListFilters,
  type SummaryFilters,
  type SummaryRow,
} from './transaction.repository.js';
import { CacheService, CacheKeys } from '../../services/cache.service.js';
import { NotFoundError } from '../../common/errors.js';

export class TransactionService {
  private readonly repo: TransactionRepository;
  private readonly cache: CacheService;

  constructor(knex: Knex, redis: Redis) {
    this.repo = new TransactionRepository(knex);
    this.cache = new CacheService(redis);
  }

  async findById(id: string): Promise<Transaction> {
    const tx = await this.cache.getOrSet<Transaction>(
      CacheKeys.transaction(id),
      () => this.repo.findById(id) as Promise<Transaction>
    );
    if (!tx) throw new NotFoundError('Transaction');
    return tx;
  }

  async findByUserId(userId: string, filters: ListFilters = {}): Promise<Transaction[]> {
    // Only cache the unfiltered list — filtered queries skip cache to avoid blow-up.
    const isPlain = !filters.type && !filters.from && !filters.to && !filters.limit;
    if (!isPlain) return this.repo.findByUserId(userId, filters);

    return this.cache.getOrSet<Transaction[]>(
      CacheKeys.transactionsByUser(userId),
      () => this.repo.findByUserId(userId, filters)
    );
  }

  async create(data: CreateTransactionDTO): Promise<Transaction> {
    const tx = await this.repo.create(data);
    await this.invalidate(undefined, data.user_id);
    return tx;
  }

  async update(id: string, data: UpdateTransactionDTO): Promise<Transaction> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Transaction');

    const tx = await this.repo.update(id, data);
    if (!tx) throw new NotFoundError('Transaction');
    await this.invalidate(id, existing.user_id);
    return tx;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Transaction');

    await this.repo.delete(id);
    await this.invalidate(id, existing.user_id);
    return true;
  }

  async summarizeByUser(userId: string, filters: SummaryFilters = {}): Promise<SummaryRow[]> {
    const isPlain = !filters.from && !filters.to && !filters.currency;
    if (!isPlain) return this.repo.summarizeByUser(userId, filters);

    return this.cache.getOrSet<SummaryRow[]>(
      CacheKeys.transactionsSummary(userId),
      () => this.repo.summarizeByUser(userId, filters),
      60
    );
  }

  private async invalidate(id?: string, userId?: string): Promise<void> {
    const ops: Promise<void>[] = [];
    if (id) ops.push(this.cache.del(CacheKeys.transaction(id)));
    if (userId) {
      ops.push(this.cache.del(CacheKeys.transactionsByUser(userId)));
      ops.push(this.cache.del(CacheKeys.transactionsSummary(userId)));
    }
    await Promise.all(ops);
  }
}
