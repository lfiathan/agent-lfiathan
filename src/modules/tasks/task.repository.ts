import type { Knex } from 'knex';
import type { TaskStatus, TaskSource } from './task.schema.js';

const TABLE = 'tasks';

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  category: string | null;
  source: TaskSource;
  agent_metadata: Record<string, unknown>;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTaskDTO {
  user_id: string;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  category?: string;
  source?: TaskSource;
  agent_metadata?: Record<string, unknown>;
  due_date?: Date | null;
}

export interface UpdateTaskDTO {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  category?: string;
  agent_metadata?: Record<string, unknown>;
  due_date?: Date | null;
}

export class TaskRepository {
  constructor(private readonly knex: Knex) {}

  async findAll(): Promise<Task[]> {
    return this.knex(TABLE).select('*').orderBy('created_at', 'desc');
  }

  async findById(id: string): Promise<Task | undefined> {
    return this.knex(TABLE).where({ id }).first();
  }

  async findByUserId(userId: string): Promise<Task[]> {
    return this.knex(TABLE).where({ user_id: userId }).orderBy('created_at', 'desc');
  }

  async create(data: CreateTaskDTO): Promise<Task> {
    const [task] = await this.knex(TABLE).insert(data).returning('*');
    return task;
  }

  async update(id: string, data: UpdateTaskDTO): Promise<Task | undefined> {
    const [task] = await this.knex(TABLE)
      .where({ id })
      .update({ ...data, updated_at: this.knex.fn.now() })
      .returning('*');
    return task;
  }

  async delete(id: string): Promise<number> {
    return this.knex(TABLE).where({ id }).del();
  }
}
