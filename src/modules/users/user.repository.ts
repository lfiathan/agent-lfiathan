import type { Knex } from 'knex';

const TABLE = 'users';

export interface User {
  id: string;
  email: string;
  name: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserDTO {
  email: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateUserDTO {
  email?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export class UserRepository {
  constructor(private readonly knex: Knex) {}

  async findAll(): Promise<User[]> {
    return this.knex(TABLE).select('*').orderBy('created_at', 'desc');
  }

  async findById(id: string): Promise<User | undefined> {
    return this.knex(TABLE).where({ id }).first();
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return this.knex(TABLE).where({ email }).first();
  }

  async create(data: CreateUserDTO): Promise<User> {
    const [user] = await this.knex(TABLE).insert(data).returning('*');
    return user;
  }

  async update(id: string, data: UpdateUserDTO): Promise<User | undefined> {
    const [user] = await this.knex(TABLE)
      .where({ id })
      .update({ ...data, updated_at: this.knex.fn.now() })
      .returning('*');
    return user;
  }

  async delete(id: string): Promise<number> {
    return this.knex(TABLE).where({ id }).del();
  }
}
