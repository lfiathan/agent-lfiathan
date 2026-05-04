import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { HermesService } from '../services/hermes.service.js';
import config from '../config/index.js';

async function hermesPlugin(fastify: FastifyInstance): Promise<void> {
  const hermes = new HermesService({
    apiUrl: config.hermes.apiUrl,
    apiKey: config.hermes.apiKey,
    model: config.hermes.model,
    timeout: config.hermes.timeout,
    logger: fastify.log,
  });

  // Check availability (non-blocking — agent may start later)
  try {
    const health = await hermes.getHealth();
    if (health.available) {
      fastify.log.info('Hermes agent is available');
    } else {
      fastify.log.warn('Hermes agent is not reachable — agent features will be degraded');
    }
  } catch {
    fastify.log.warn('Hermes agent health check failed — will retry on demand');
  }

  fastify.decorate('hermes', hermes);
}

export default fp(hermesPlugin, {
  name: 'hermes',
});
