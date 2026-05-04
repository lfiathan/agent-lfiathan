import { UserRepository } from './user.repository.js';
import { CacheService, CacheKeys } from '../../services/cache.service.js';
import { NotFoundError, ConflictError } from '../../common/errors.js';

export class UserService {
  /**
   * @param {import('knex').Knex} knex
   * @param {import('ioredis').Redis} redis
   */
  constructor(knex, redis) {
    this.repo = new UserRepository(knex);
    this.cache = new CacheService(redis);
  }

  async findAll() {
    return this.cache.getOrSet(CacheKeys.userList(), () => this.repo.findAll());
  }

  async findById(id) {
    const user = await this.cache.getOrSet(CacheKeys.user(id), () => this.repo.findById(id));
    if (!user) throw new NotFoundError('User');
    return user;
  }

  async create(data) {
    const existing = await this.repo.findByEmail(data.email);
    if (existing) throw new ConflictError(`User with email ${data.email} already exists`);

    const user = await this.repo.create(data);
    await this._invalidateCache();
    return user;
  }

  async update(id, data) {
    // If email is being changed, check for conflicts
    if (data.email) {
      const existing = await this.repo.findByEmail(data.email);
      if (existing && existing.id !== id) {
        throw new ConflictError(`Email ${data.email} is already in use`);
      }
    }

    const user = await this.repo.update(id, data);
    if (!user) throw new NotFoundError('User');
    await this._invalidateCache(id);
    return user;
  }

  async delete(id) {
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new NotFoundError('User');
    await this._invalidateCache(id);
    return true;
  }

  /** @param {string} [id] Specific user ID, or invalidate all */
  async _invalidateCache(id) {
    if (id) {
      await this.cache.del(CacheKeys.user(id));
    }
    await this.cache.del(CacheKeys.userList());
  }
}
