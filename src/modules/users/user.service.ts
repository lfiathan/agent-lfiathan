import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import { UserRepository, type User, type CreateUserDTO, type UpdateUserDTO } from './user.repository.js';
import { CacheService, CacheKeys } from '../../services/cache.service.js';
import { NotFoundError, ConflictError } from '../../common/errors.js';

export class UserService {
  private readonly repo: UserRepository;
  private readonly cache: CacheService;

  constructor(knex: Knex, redis: Redis) {
    this.repo = new UserRepository(knex);
    this.cache = new CacheService(redis);
  }

  async findAll(): Promise<User[]> {
    return this.cache.getOrSet<User[]>(CacheKeys.userList(), () => this.repo.findAll());
  }

  async findById(id: string): Promise<User> {
    const user = await this.cache.getOrSet<User>(CacheKeys.user(id), () =>
      this.repo.findById(id) as Promise<User>
    );
    if (!user) throw new NotFoundError('User');
    return user;
  }

  async create(data: CreateUserDTO): Promise<User> {
    const existing = await this.repo.findByEmail(data.email);
    if (existing) throw new ConflictError(`User with email ${data.email} already exists`);

    const user = await this.repo.create(data);
    await this.invalidateCache();
    return user;
  }

  async update(id: string, data: UpdateUserDTO): Promise<User> {
    if (data.email) {
      const existing = await this.repo.findByEmail(data.email);
      if (existing && existing.id !== id) {
        throw new ConflictError(`Email ${data.email} is already in use`);
      }
    }

    const user = await this.repo.update(id, data);
    if (!user) throw new NotFoundError('User');
    await this.invalidateCache(id);
    return user;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new NotFoundError('User');
    await this.invalidateCache(id);
    return true;
  }

  private async invalidateCache(id?: string): Promise<void> {
    if (id) {
      await this.cache.del(CacheKeys.user(id));
    }
    await this.cache.del(CacheKeys.userList());
  }
}
