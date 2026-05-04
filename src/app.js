import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';

import config from './config/index.js';
import databasePlugin from './plugins/database.js';
import redisPlugin from './plugins/redis.js';
import hermesPlugin from './plugins/hermes.js';
import { registerErrorHandler, registerRequestHooks } from './common/hooks.js';

import userRoutes from './modules/users/user.routes.js';
import taskRoutes from './modules/tasks/task.routes.js';
import agentRoutes from './modules/agents/agent.routes.js';

/**
 * Build and configure the Fastify application.
 * @param {object} [opts] - Override options for testing
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildApp(opts = {}) {
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

  // Store config on instance for access in hooks
  fastify.decorate('config', config);

  // ── Plugins ──────────────────────────────────────
  await fastify.register(cors, { origin: true });
  await fastify.register(sensible);
  await fastify.register(databasePlugin);
  await fastify.register(redisPlugin);
  await fastify.register(hermesPlugin);

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

    let hermesOk = false;
    try {
      const h = await fastify.hermes.getHealth();
      hermesOk = h.available;
    } catch { /* ignored */ }

    const status = dbOk && redisOk ? 'ok' : 'degraded';

    return {
      status,
      services: {
        database: dbOk ? 'connected' : 'disconnected',
        redis: redisOk ? 'connected' : 'disconnected',
        hermes: hermesOk ? 'available' : 'unavailable',
      },
      timestamp: new Date().toISOString(),
    };
  });

  // ── Routes ───────────────────────────────────────
  await fastify.register(userRoutes, { prefix: '/api/users' });
  await fastify.register(taskRoutes, { prefix: '/api/tasks' });
  await fastify.register(agentRoutes, { prefix: '/api/agents' });

  return fastify;
}
