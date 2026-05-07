import type { Knex } from 'knex';
import type { AssetClass } from './portfolio.schema.js';

const TABLE = 'portfolio_holdings';

export interface PortfolioHolding {
  id: string;
  user_id: string;
  asset_class: AssetClass;
  symbol: string;
  name: string | null;
  quantity: string;
  average_cost: string | null;
  cost_currency: string;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateHoldingDTO {
  user_id: string;
  asset_class: AssetClass;
  symbol: string;
  name?: string;
  quantity: number;
  average_cost?: number;
  cost_currency?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateHoldingDTO {
  name?: string;
  quantity?: number;
  average_cost?: number;
  cost_currency?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface ListFilters {
  asset_class?: AssetClass;
}

export class PortfolioRepository {
  constructor(private readonly knex: Knex) {}

  async findById(id: string): Promise<PortfolioHolding | undefined> {
    return this.knex(TABLE).where({ id }).first();
  }

  async findByUserId(
    userId: string,
    filters: ListFilters = {}
  ): Promise<PortfolioHolding[]> {
    const query = this.knex(TABLE).where({ user_id: userId });
    if (filters.asset_class) query.andWhere({ asset_class: filters.asset_class });
    return query.orderBy([
      { column: 'asset_class', order: 'asc' },
      { column: 'symbol', order: 'asc' },
    ]);
  }

  async findOneByAsset(
    userId: string,
    assetClass: AssetClass,
    symbol: string
  ): Promise<PortfolioHolding | undefined> {
    return this.knex(TABLE)
      .where({ user_id: userId, asset_class: assetClass, symbol })
      .first();
  }

  async create(data: CreateHoldingDTO): Promise<PortfolioHolding> {
    const [row] = await this.knex(TABLE).insert(data).returning('*');
    return row;
  }

  async update(id: string, data: UpdateHoldingDTO): Promise<PortfolioHolding | undefined> {
    const [row] = await this.knex(TABLE)
      .where({ id })
      .update({ ...data, updated_at: this.knex.fn.now() })
      .returning('*');
    return row;
  }

  async delete(id: string): Promise<number> {
    return this.knex(TABLE).where({ id }).del();
  }

  /** Atomic quantity adjustment, optionally updating average_cost. */
  async adjustQuantity(
    id: string,
    delta: number,
    averageCost?: number
  ): Promise<PortfolioHolding | undefined> {
    const update: Record<string, unknown> = {
      quantity: this.knex.raw('quantity + ?', [delta]),
      updated_at: this.knex.fn.now(),
    };
    if (averageCost !== undefined) update.average_cost = averageCost;

    const [row] = await this.knex(TABLE).where({ id }).update(update).returning('*');
    return row;
  }
}
