import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';

import config from './config/index.js';
import databasePlugin from './plugins/database.js';
import redisPlugin from './plugins/redis.js';
import { registerErrorHandler, registerRequestHooks } from './common/hooks.js';

import userRoutes from './modules/users/user.routes.js';
import taskRoutes from './modules/tasks/task.routes.js';
import transactionRoutes from './modules/finance/transaction.routes.js';
import portfolioRoutes from './modules/finance/portfolio.routes.js';
import dietaryRoutes from './modules/dietary/dietary.routes.js';
import stravaRoutes from './modules/strava/strava.routes.js';

export async function buildApp(opts: { logLevel?: string } = {}) {
  const fastify = Fastify({
    logger: {
      level: opts.logLevel || config.logLevel,
      ...(config.env === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  fastify.decorate('config', config);

  // ── Plugins ──────────────────────────────────────
  await fastify.register(cors, { origin: true });
  await fastify.register(sensible);
  await fastify.register(databasePlugin);
  await fastify.register(redisPlugin);

  // ── Hooks ────────────────────────────────────────
  registerErrorHandler(fastify);
  registerRequestHooks(fastify);

  // ── Health check ─────────────────────────────────
  fastify.get('/health', async () => {
    const dbOk = await fastify.knex
      .raw('SELECT 1')
      .then(() => true)
      .catch(() => false);

    const redisOk = await fastify.redis
      .ping()
      .then(() => true)
      .catch(() => false);

    const status = dbOk && redisOk ? 'ok' : 'degraded';

    return {
      status,
      services: {
        database: dbOk ? 'connected' : 'disconnected',
        redis: redisOk ? 'connected' : 'disconnected',
      },
      timestamp: new Date().toISOString(),
    };
  });

  // ── Routes ───────────────────────────────────────
  await fastify.register(userRoutes, { prefix: '/api/users' });
  await fastify.register(taskRoutes, { prefix: '/api/tasks' });
  await fastify.register(transactionRoutes, { prefix: '/api/transactions' });
  await fastify.register(portfolioRoutes, { prefix: '/api/portfolio' });
  await fastify.register(dietaryRoutes, { prefix: '/api/dietary' });
  await fastify.register(stravaRoutes, { prefix: '/api/strava' });

  return fastify;
}
