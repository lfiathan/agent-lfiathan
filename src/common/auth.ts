import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

const PUBLIC_PATHS = new Set(['/health']);

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Per-agent API key auth. Each entry in config.agentApiKeys maps a name to a
 * key and the route prefixes that key is allowed to call. A key grants access
 * only to its own scopes — nothing else, including other agents' modules.
 */
export function registerApiKeyAuth(fastify: FastifyInstance): void {
  const agents = Object.entries(fastify.config.agentApiKeys);

  if (agents.length === 0) {
    fastify.log.warn('AGENT_API_KEYS not configured — all /api routes are unauthenticated');
    return;
  }

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const path = request.url.split('?')[0];
    if (PUBLIC_PATHS.has(path)) return;

    const presentedKey = request.headers['x-api-key'];
    if (typeof presentedKey !== 'string' || !presentedKey) {
      throw new AppError('Missing API key', 401, 'UNAUTHORIZED');
    }

    const agent = agents.find(([, cfg]) => safeEqual(cfg.key, presentedKey));
    if (!agent) {
      throw new AppError('Invalid API key', 401, 'UNAUTHORIZED');
    }

    const [, { scopes }] = agent;
    const allowed = scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
    if (!allowed) {
      throw new AppError('This API key is not permitted to access this resource', 403, 'FORBIDDEN');
    }
  });
}
