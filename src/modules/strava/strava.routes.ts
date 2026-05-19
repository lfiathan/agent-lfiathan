import type { FastifyInstance, FastifyRequest } from 'fastify';
import { StravaService, type StravaWebhookEvent } from './strava.service.js';
import {
  callbackBodySchema,
  connectQuerySchema,
  syncBodySchema,
  userParamsSchema,
  webhookEventBodySchema,
  webhookVerifyQuerySchema,
} from './strava.schema.js';

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

interface WebhookVerifyQuery {
  'hub.mode': string;
  'hub.verify_token': string;
  'hub.challenge': string;
}

export default async function stravaRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new StravaService(fastify.knex, fastify.redis, {
    clientId: fastify.config.strava.clientId,
    clientSecret: fastify.config.strava.clientSecret,
    redirectUri: process.env.STRAVA_REDIRECT_URI,
    telegramBotToken: fastify.config.strava.analysisTelegramBotToken,
    telegramChatId: fastify.config.strava.analysisTelegramChatId,
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

  fastify.get(
    '/webhook',
    { schema: webhookVerifyQuerySchema },
    async (request: FastifyRequest<{ Querystring: WebhookVerifyQuery }>, reply) => {
      if (request.query['hub.mode'] !== 'subscribe') {
        return reply.code(400).send({ error: 'Invalid Strava webhook mode' });
      }

      if (!fastify.config.strava.webhookVerifyToken || request.query['hub.verify_token'] !== fastify.config.strava.webhookVerifyToken) {
        return reply.code(403).send({ error: 'Invalid Strava webhook verify token' });
      }

      return { 'hub.challenge': request.query['hub.challenge'] };
    }
  );

  fastify.post(
    '/webhook',
    { schema: webhookEventBodySchema },
    async (request: FastifyRequest<{ Body: StravaWebhookEvent }>) => {
      const result = await service.handleWebhookEvent(request.body);
      return { data: result };
    }
  );

  fastify.get(
    '/:userId/latest-analysis',
    { schema: userParamsSchema },
    async (request: FastifyRequest<{ Params: UserIdParams }>) => {
      const result = await service.analyzeLatestActivity(request.params.userId);
      return { data: result };
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
