/**
 * Reusable Redis caching service with read-through pattern
 * and namespace-based key management.
 */
export class CacheService {
  /**
   * @param {import('ioredis').Redis} redis
   * @param {object} [options]
   * @param {number} [options.defaultTTL=300] Default TTL in seconds
   */
  constructor(redis, options = {}) {
    this.redis = redis;
    this.defaultTTL = options.defaultTTL || 300;
  }

  /**
   * Get a cached value.
   * @param {string} key
   * @returns {Promise<any|null>}
   */
  async get(key) {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Set a cached value.
   * @param {string} key
   * @param {any} value
   * @param {number} [ttl] TTL in seconds
   */
  async set(key, value, ttl) {
    const serialized = JSON.stringify(value);
    const expiry = ttl || this.defaultTTL;
    await this.redis.set(key, serialized, 'EX', expiry);
  }

  /**
   * Delete a specific key.
   * @param {string} key
   */
  async del(key) {
    await this.redis.del(key);
  }

  /**
   * Delete all keys matching a pattern.
   * Uses SCAN to avoid blocking Redis.
   * @param {string} pattern - e.g. 'users:*'
   */
  async delPattern(pattern) {
    // ioredis keyPrefix is automatically prepended,
    // so we need to scan with the raw pattern
    const stream = this.redis.scanStream({ match: pattern, count: 100 });

    return new Promise((resolve, reject) => {
      const pipeline = this.redis.pipeline();
      let count = 0;

      stream.on('data', (keys) => {
        for (const key of keys) {
          // Keys from scanStream include the prefix, but del with keyPrefix
          // would double-prefix. Use the raw key with unPrefix.
          const unprefixed = this._stripPrefix(key);
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
   *
   * @param {string} key
   * @param {() => Promise<any>} fetchFn
   * @param {number} [ttl]
   * @returns {Promise<any>}
   */
  async getOrSet(key, fetchFn, ttl) {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const fresh = await fetchFn();
    if (fresh !== null && fresh !== undefined) {
      await this.set(key, fresh, ttl);
    }
    return fresh;
  }

  /**
   * Strip the ioredis keyPrefix from a raw Redis key.
   * @param {string} key
   * @returns {string}
   */
  _stripPrefix(key) {
    const prefix = this.redis.options?.keyPrefix || '';
    if (prefix && key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
    return key;
  }
}

/* ── Cache key helpers ────────────────────────────────── */

export const CacheKeys = {
  user: (id) => `users:${id}`,
  userByEmail: (email) => `users:email:${email}`,
  userList: () => 'users:list',
  usersPattern: () => 'users:*',

  task: (id) => `tasks:${id}`,
  tasksByUser: (userId) => `tasks:user:${userId}`,
  tasksPattern: () => 'tasks:*',
  tasksUserPattern: (userId) => `tasks:user:${userId}:*`,
};
