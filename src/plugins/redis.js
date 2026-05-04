import fp from 'fastify-plugin';
import Redis from 'ioredis';
import config from '../config/index.js';

async function redisPlugin(fastify) {
  const redis = new Redis(config.redis.url, {
    keyPrefix: config.redis.keyPrefix,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null; // Stop retrying
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
