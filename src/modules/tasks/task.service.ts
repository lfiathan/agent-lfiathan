import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import { TaskRepository, type Task, type CreateTaskDTO, type UpdateTaskDTO } from './task.repository.js';
import { CacheService, CacheKeys } from '../../services/cache.service.js';
import { NotFoundError } from '../../common/errors.js';

export class TaskService {
  private readonly repo: TaskRepository;
  private readonly cache: CacheService;

  constructor(knex: Knex, redis: Redis) {
    this.repo = new TaskRepository(knex);
    this.cache = new CacheService(redis);
  }

  async findAll(): Promise<Task[]> {
    return this.repo.findAll();
  }

  async findById(id: string): Promise<Task> {
    const task = await this.cache.getOrSet<Task>(CacheKeys.task(id), () =>
      this.repo.findById(id) as Promise<Task>
    );
    if (!task) throw new NotFoundError('Task');
    return task;
  }

  async findByUserId(userId: string): Promise<Task[]> {
    return this.cache.getOrSet<Task[]>(
      CacheKeys.tasksByUser(userId),
      () => this.repo.findByUserId(userId)
    );
  }

  async create(data: CreateTaskDTO): Promise<Task> {
    const task = await this.repo.create(data);
    await this.invalidateCache(undefined, data.user_id);
    return task;
  }

  async update(id: string, data: UpdateTaskDTO): Promise<Task> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Task');

    const task = await this.repo.update(id, data);
    if (!task) throw new NotFoundError('Task');
    await this.invalidateCache(id, existing.user_id);
    return task;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Task');

    await this.repo.delete(id);
    await this.invalidateCache(id, existing.user_id);
    return true;
  }

  private async invalidateCache(taskId?: string, userId?: string): Promise<void> {
    const ops: Promise<void>[] = [];
    if (taskId) ops.push(this.cache.del(CacheKeys.task(taskId)));
    if (userId) ops.push(this.cache.del(CacheKeys.tasksByUser(userId)));
    await Promise.all(ops);
  }
}
