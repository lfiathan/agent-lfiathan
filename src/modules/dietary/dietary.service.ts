import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import {
  DietaryRepository,
  type DietaryLog,
  type CreateDietaryLogDTO,
  type UpdateDietaryLogDTO,
  type ListFilters,
} from './dietary.repository.js';
import { CacheService, CacheKeys } from '../../services/cache.service.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';

export class DietaryService {
  private readonly repo: DietaryRepository;
  private readonly cache: CacheService;

  constructor(knex: Knex, redis: Redis) {
    this.repo = new DietaryRepository(knex);
    this.cache = new CacheService(redis);
  }

  async findById(id: string): Promise<DietaryLog> {
    const log = await this.cache.getOrSet<DietaryLog>(
      CacheKeys.dietaryLog(id),
      () => this.repo.findById(id) as Promise<DietaryLog>
    );
    if (!log) throw new NotFoundError('Dietary log');
    return log;
  }

  async findByUserAndDate(userId: string, date: string): Promise<DietaryLog> {
    const log = await this.cache.getOrSet<DietaryLog>(
      CacheKeys.dietaryByUserDate(userId, date),
      () => this.repo.findByUserAndDate(userId, date) as Promise<DietaryLog>
    );
    if (!log) throw new NotFoundError('Dietary log');
    return log;
  }

  async findByUserId(userId: string, filters: ListFilters = {}): Promise<DietaryLog[]> {
    const isPlain = !filters.from && !filters.to && !filters.training_only && !filters.limit;
    if (!isPlain) return this.repo.findByUserId(userId, filters);

    return this.cache.getOrSet<DietaryLog[]>(
      CacheKeys.dietaryByUser(userId),
      () => this.repo.findByUserId(userId, filters)
    );
  }

  async create(data: CreateDietaryLogDTO): Promise<DietaryLog> {
    const existing = await this.repo.findByUserAndDate(data.user_id, data.log_date);
    if (existing) {
      throw new ConflictError(
        `Dietary log already exists for ${data.log_date}; use PUT to update`
      );
    }

    const log = await this.repo.create(data);
    await this.invalidate(undefined, data.user_id, data.log_date);
    return log;
  }

  async update(id: string, data: UpdateDietaryLogDTO): Promise<DietaryLog> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Dietary log');

    const log = await this.repo.update(id, data);
    if (!log) throw new NotFoundError('Dietary log');
    await this.invalidate(id, existing.user_id, existing.log_date);
    return log;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Dietary log');

    await this.repo.delete(id);
    await this.invalidate(id, existing.user_id, existing.log_date);
    return true;
  }

  private async invalidate(id?: string, userId?: string, date?: string): Promise<void> {
    const ops: Promise<void>[] = [];
    if (id) ops.push(this.cache.del(CacheKeys.dietaryLog(id)));
    if (userId) {
      ops.push(this.cache.del(CacheKeys.dietaryByUser(userId)));
      if (date) ops.push(this.cache.del(CacheKeys.dietaryByUserDate(userId, date)));
    }
    await Promise.all(ops);
  }
}
