import type { Redis } from 'ioredis';

/**
 * Reusable Redis caching service with read-through pattern
 * and namespace-based key management.
 */
export class CacheService {
  private readonly redis: Redis;
  private readonly defaultTTL: number;

  constructor(redis: Redis, options: { defaultTTL?: number } = {}) {
    this.redis = redis;
    this.defaultTTL = options.defaultTTL || 300;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const expiry = ttl || this.defaultTTL;
    await this.redis.set(key, serialized, 'EX', expiry);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Delete all keys matching a pattern.
   * Uses SCAN to avoid blocking Redis.
   */
  async delPattern(pattern: string): Promise<number> {
    const stream = this.redis.scanStream({ match: pattern, count: 100 });

    return new Promise((resolve, reject) => {
      const pipeline = this.redis.pipeline();
      let count = 0;

      stream.on('data', (keys: string[]) => {
        for (const key of keys) {
          const unprefixed = this.stripPrefix(key);
          pipeline.del(unprefixed);
          count++;
        }
      });

      stream.on('end', async () => {
        if (count > 0) await pipeline.exec();
        resolve(count);
      });

      stream.on('error', reject);
    });
  }

  /**
   * Read-through cache pattern.
   * Returns cached value if available, otherwise calls fetchFn,
   * caches the result, and returns it.
   */
  async getOrSet<T>(key: string, fetchFn: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const fresh = await fetchFn();
    if (fresh !== null && fresh !== undefined) {
      await this.set(key, fresh, ttl);
    }
    return fresh;
  }

  private stripPrefix(key: string): string {
    const prefix = this.redis.options?.keyPrefix || '';
    if (prefix && key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
    return key;
  }
}

/* ── Cache key helpers ────────────────────────────────── */

export const CacheKeys = {
  user: (id: string) => `users:${id}`,
  userByEmail: (email: string) => `users:email:${email}`,
  userList: () => 'users:list',
  usersPattern: () => 'users:*',

  task: (id: string) => `tasks:${id}`,
  tasksByUser: (userId: string) => `tasks:user:${userId}`,
  tasksPattern: () => 'tasks:*',
  tasksUserPattern: (userId: string) => `tasks:user:${userId}:*`,

  transaction: (id: string) => `transactions:${id}`,
  transactionsByUser: (userId: string) => `transactions:user:${userId}`,
  transactionsSummary: (userId: string) => `transactions:user:${userId}:summary`,

  holding: (id: string) => `portfolio:${id}`,
  portfolioByUser: (userId: string) => `portfolio:user:${userId}`,

  dietaryLog: (id: string) => `dietary:${id}`,
  dietaryByUser: (userId: string) => `dietary:user:${userId}`,
  dietaryByUserDate: (userId: string, date: string) => `dietary:user:${userId}:date:${date}`,
};
