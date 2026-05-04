import { TaskRepository } from './task.repository.js';
import { CacheService, CacheKeys } from '../../services/cache.service.js';
import { NotFoundError } from '../../common/errors.js';

export class TaskService {
  /**
   * @param {import('knex').Knex} knex
   * @param {import('ioredis').Redis} redis
   */
  constructor(knex, redis) {
    this.repo = new TaskRepository(knex);
    this.cache = new CacheService(redis);
  }

  async findAll() {
    return this.repo.findAll();
  }

  async findById(id) {
    const task = await this.cache.getOrSet(CacheKeys.task(id), () => this.repo.findById(id));
    if (!task) throw new NotFoundError('Task');
    return task;
  }

  async findByUserId(userId) {
    return this.cache.getOrSet(
      CacheKeys.tasksByUser(userId),
      () => this.repo.findByUserId(userId)
    );
  }

  async create(data) {
    const task = await this.repo.create(data);
    await this._invalidateCache(null, data.user_id);
    return task;
  }

  async update(id, data) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Task');

    const task = await this.repo.update(id, data);
    await this._invalidateCache(id, existing.user_id);
    return task;
  }

  async delete(id) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Task');

    await this.repo.delete(id);
    await this._invalidateCache(id, existing.user_id);
    return true;
  }

  /**
   * @param {string|null} taskId
   * @param {string} userId
   */
  async _invalidateCache(taskId, userId) {
    const ops = [];
    if (taskId) ops.push(this.cache.del(CacheKeys.task(taskId)));
    if (userId) ops.push(this.cache.del(CacheKeys.tasksByUser(userId)));
    await Promise.all(ops);
  }
}
