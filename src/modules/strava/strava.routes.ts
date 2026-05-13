import type { FastifyInstance, FastifyRequest } from 'fastify';
import { StravaService } from './strava.service.js';
import { callbackBodySchema, connectQuerySchema, syncBodySchema, userParamsSchema } from './strava.schema.js';

interface ConnectQuery {
  userId: string;
  redirectUri?: string;
  scope?: string;
}

interface CallbackBody {
  userId: string;
  code: string;
  redirectUri?: string;
}

interface UserIdParams {
  userId: string;
}

interface SyncBody {
  page?: number;
  perPage?: number;
}

export default async function stravaRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new StravaService(fastify.knex, fastify.redis, {
    clientId: fastify.config.strava.clientId,
    clientSecret: fastify.config.strava.clientSecret,
    redirectUri: process.env.STRAVA_REDIRECT_URI,
  });

  fastify.get(
    '/connect',
    { schema: connectQuerySchema },
    async (request: FastifyRequest<{ Querystring: ConnectQuery }>) => {
      const authUrl = service.getAuthorizationUrl(request.query);
      return { data: { authUrl } };
    }
  );

  fastify.post('/oauth/callback', { schema: callbackBodySchema }, async (request: FastifyRequest<{ Body: CallbackBody }>) => {
    const connection = await service.exchangeCode(request.body);
    return { data: connection };
  });

  fastify.post(
    '/:userId/refresh',
    { schema: userParamsSchema },
    async (request: FastifyRequest<{ Params: UserIdParams }>) => {
      const connection = await service.refreshToken(request.params.userId);
      return { data: connection };
    }
  );

  fastify.get(
    '/:userId/status',
    { schema: userParamsSchema },
    async (request: FastifyRequest<{ Params: UserIdParams }>) => {
      const status = await service.getStatus(request.params.userId);
      return { data: status };
    }
  );

  fastify.post(
    '/:userId/sync',
    { schema: { ...userParamsSchema, ...syncBodySchema } },
    async (request: FastifyRequest<{ Params: UserIdParams; Body: SyncBody }>) => {
      const synced = await service.syncActivities(
        request.params.userId,
        request.body?.page ?? 1,
        request.body?.perPage ?? 50
      );
      return { data: synced };
    }
  );
}
