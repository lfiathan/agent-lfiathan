import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import {
  PortfolioRepository,
  type PortfolioHolding,
  type CreateHoldingDTO,
  type UpdateHoldingDTO,
  type ListFilters,
} from './portfolio.repository.js';
import { CacheService, CacheKeys } from '../../services/cache.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';

export class PortfolioService {
  private readonly repo: PortfolioRepository;
  private readonly cache: CacheService;

  constructor(knex: Knex, redis: Redis) {
    this.repo = new PortfolioRepository(knex);
    this.cache = new CacheService(redis);
  }

  async findById(id: string): Promise<PortfolioHolding> {
    const holding = await this.cache.getOrSet<PortfolioHolding>(
      CacheKeys.holding(id),
      () => this.repo.findById(id) as Promise<PortfolioHolding>
    );
    if (!holding) throw new NotFoundError('Portfolio holding');
    return holding;
  }

  async findByUserId(
    userId: string,
    filters: ListFilters = {}
  ): Promise<PortfolioHolding[]> {
    const isPlain = !filters.asset_class;
    if (!isPlain) return this.repo.findByUserId(userId, filters);

    return this.cache.getOrSet<PortfolioHolding[]>(
      CacheKeys.portfolioByUser(userId),
      () => this.repo.findByUserId(userId, filters)
    );
  }

  async create(data: CreateHoldingDTO): Promise<PortfolioHolding> {
    const existing = await this.repo.findOneByAsset(
      data.user_id,
      data.asset_class,
      data.symbol
    );
    if (existing) {
      throw new ConflictError(
        `Holding for ${data.asset_class}:${data.symbol} already exists for this user`
      );
    }

    const holding = await this.repo.create(data);
    await this.invalidate(undefined, data.user_id);
    return holding;
  }

  async update(id: string, data: UpdateHoldingDTO): Promise<PortfolioHolding> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Portfolio holding');

    const holding = await this.repo.update(id, data);
    if (!holding) throw new NotFoundError('Portfolio holding');
    await this.invalidate(id, existing.user_id);
    return holding;
  }

  async adjust(
    id: string,
    delta: number,
    averageCost?: number
  ): Promise<PortfolioHolding> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Portfolio holding');

    const projected = Number(existing.quantity) + delta;
    if (projected < 0) {
      throw new ValidationError(
        `Adjustment would result in negative quantity (${projected})`
      );
    }

    const holding = await this.repo.adjustQuantity(id, delta, averageCost);
    if (!holding) throw new NotFoundError('Portfolio holding');
    await this.invalidate(id, existing.user_id);
    return holding;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Portfolio holding');

    await this.repo.delete(id);
    await this.invalidate(id, existing.user_id);
    return true;
  }

  private async invalidate(id?: string, userId?: string): Promise<void> {
    const ops: Promise<void>[] = [];
    if (id) ops.push(this.cache.del(CacheKeys.holding(id)));
    if (userId) ops.push(this.cache.del(CacheKeys.portfolioByUser(userId)));
    await Promise.all(ops);
  }
}
