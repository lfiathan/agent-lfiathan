import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PortfolioService } from './portfolio.service.js';
import {
  createHoldingSchema,
  updateHoldingSchema,
  adjustHoldingSchema,
  holdingParamsSchema,
  portfolioByUserSchema,
  type AssetClass,
} from './portfolio.schema.js';
import type {
  CreateHoldingDTO,
  UpdateHoldingDTO,
} from './portfolio.repository.js';

interface IdParams { id: string }
interface UserIdParams { userId: string }
interface ListQuery { asset_class?: AssetClass }
interface AdjustBody { delta: number; average_cost?: number }

export default async function portfolioRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new PortfolioService(fastify.knex, fastify.redis);

  fastify.get(
    '/user/:userId',
    { schema: portfolioByUserSchema },
    async (request: FastifyRequest<{ Params: UserIdParams; Querystring: ListQuery }>) => {
      const holdings = await service.findByUserId(request.params.userId, request.query);
      return { data: holdings };
    }
  );

  fastify.get(
    '/:id',
    { schema: holdingParamsSchema },
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const holding = await service.findById(request.params.id);
      return { data: holding };
    }
  );

  fastify.post('/', { schema: createHoldingSchema }, async (request, reply) => {
    const holding = await service.create(request.body as CreateHoldingDTO);
    return reply.status(201).send({ data: holding });
  });

  fastify.put(
    '/:id',
    { schema: { ...holdingParamsSchema, ...updateHoldingSchema } },
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const holding = await service.update(request.params.id, request.body as UpdateHoldingDTO);
      return { data: holding };
    }
  );

  fastify.post(
    '/:id/adjust',
    { schema: { ...holdingParamsSchema, ...adjustHoldingSchema } },
    async (request: FastifyRequest<{ Params: IdParams; Body: AdjustBody }>) => {
      const { delta, average_cost } = request.body;
      const holding = await service.adjust(request.params.id, delta, average_cost);
      return { data: holding };
    }
  );

  fastify.delete(
    '/:id',
    { schema: holdingParamsSchema },
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      await service.delete(request.params.id);
      return reply.status(204).send();
    }
  );
}
