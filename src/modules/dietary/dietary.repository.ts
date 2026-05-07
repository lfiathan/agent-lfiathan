import type { Knex } from 'knex';
import type { TrainingIntensity } from './dietary.schema.js';

const TABLE = 'dietary_logs';

export interface FoodEntry {
  name: string;
  grams?: number;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  meal?: string;
  [key: string]: unknown;
}

export interface DietaryLog {
  id: string;
  user_id: string;
  log_date: string; // YYYY-MM-DD (pg date)
  calories: number;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  fiber_g: string | null;
  water_ml: number | null;

  training_block: boolean;
  training_intensity: TrainingIntensity | null;
  training_distance_km: string | null;
  training_notes: string | null;

  supplement_creatine: boolean;
  supplement_magnesium: boolean;
  supplement_vitamin_c: boolean;

  food_entries: FoodEntry[];
  metadata: Record<string, unknown>;
  notes: string | null;

  created_at: Date;
  updated_at: Date;
}

export interface CreateDietaryLogDTO {
  user_id: string;
  log_date: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  water_ml?: number;
  training_block?: boolean;
  training_intensity?: TrainingIntensity;
  training_distance_km?: number;
  training_notes?: string;
  supplement_creatine?: boolean;
  supplement_magnesium?: boolean;
  supplement_vitamin_c?: boolean;
  food_entries?: FoodEntry[];
  metadata?: Record<string, unknown>;
  notes?: string;
}

export interface UpdateDietaryLogDTO {
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  water_ml?: number;
  training_block?: boolean;
  training_intensity?: TrainingIntensity;
  training_distance_km?: number;
  training_notes?: string;
  supplement_creatine?: boolean;
  supplement_magnesium?: boolean;
  supplement_vitamin_c?: boolean;
  food_entries?: FoodEntry[];
  metadata?: Record<string, unknown>;
  notes?: string;
}

export interface ListFilters {
  from?: string;
  to?: string;
  training_only?: boolean;
  limit?: number;
}

export class DietaryRepository {
  constructor(private readonly knex: Knex) {}

  async findById(id: string): Promise<DietaryLog | undefined> {
    return this.knex(TABLE).where({ id }).first();
  }

  async findByUserAndDate(userId: string, date: string): Promise<DietaryLog | undefined> {
    return this.knex(TABLE).where({ user_id: userId, log_date: date }).first();
  }

  async findByUserId(userId: string, filters: ListFilters = {}): Promise<DietaryLog[]> {
    const query = this.knex(TABLE).where({ user_id: userId });
    if (filters.from) query.andWhere('log_date', '>=', filters.from);
    if (filters.to) query.andWhere('log_date', '<=', filters.to);
    if (filters.training_only) query.andWhere({ training_block: true });
    return query.orderBy('log_date', 'desc').limit(filters.limit ?? 90);
  }

  async create(data: CreateDietaryLogDTO): Promise<DietaryLog> {
    const insert = this.serialize(data);
    const [row] = await this.knex(TABLE).insert(insert).returning('*');
    return row;
  }

  async update(id: string, data: UpdateDietaryLogDTO): Promise<DietaryLog | undefined> {
    const update = this.serialize(data);
    const [row] = await this.knex(TABLE)
      .where({ id })
      .update({ ...update, updated_at: this.knex.fn.now() })
      .returning('*');
    return row;
  }

  async delete(id: string): Promise<number> {
    return this.knex(TABLE).where({ id }).del();
  }

  /** Ensure jsonb columns are stringified — knex handles this for plain inserts but
   *  being explicit avoids surprises with arrays. */
  private serialize(data: CreateDietaryLogDTO | UpdateDietaryLogDTO): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    if (Array.isArray(out.food_entries)) {
      out.food_entries = JSON.stringify(out.food_entries);
    }
    if (out.metadata && typeof out.metadata === 'object') {
      out.metadata = JSON.stringify(out.metadata);
    }
    return out;
  }
}
