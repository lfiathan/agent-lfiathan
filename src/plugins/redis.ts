import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import config from '../config/index.js';

async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  const redis = new Redis(config.redis.url, {
    keyPrefix: config.redis.keyPrefix,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number): number | null {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  // Connect and verify
  try {
    await redis.connect();
    await redis.ping();
    fastify.log.info('Redis connection established');
  } catch (err) {
    fastify.log.error(err, 'Redis connection failed');
    throw err;
  }

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connection');
    await redis.quit();
  });
}

export default fp(redisPlugin, {
  name: 'redis',
});
