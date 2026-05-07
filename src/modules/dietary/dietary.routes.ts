import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DietaryService } from './dietary.service.js';
import {
  createDietaryLogSchema,
  updateDietaryLogSchema,
  dietaryParamsSchema,
  dietaryByUserSchema,
  dietaryByUserDateSchema,
} from './dietary.schema.js';
import type {
  CreateDietaryLogDTO,
  UpdateDietaryLogDTO,
} from './dietary.repository.js';

interface IdParams { id: string }
interface UserIdParams { userId: string }
interface UserDateParams { userId: string; date: string }
interface ListQuery {
  from?: string;
  to?: string;
  training_only?: boolean;
  limit?: number;
}

export default async function dietaryRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new DietaryService(fastify.knex, fastify.redis);

  fastify.get(
    '/user/:userId',
    { schema: dietaryByUserSchema },
    async (request: FastifyRequest<{ Params: UserIdParams; Querystring: ListQuery }>) => {
      const logs = await service.findByUserId(request.params.userId, request.query);
      return { data: logs };
    }
  );

  fastify.get(
    '/user/:userId/date/:date',
    { schema: dietaryByUserDateSchema },
    async (request: FastifyRequest<{ Params: UserDateParams }>) => {
      const log = await service.findByUserAndDate(request.params.userId, request.params.date);
      return { data: log };
    }
  );

  fastify.get(
    '/:id',
    { schema: dietaryParamsSchema },
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const log = await service.findById(request.params.id);
      return { data: log };
    }
  );

  fastify.post('/', { schema: createDietaryLogSchema }, async (request, reply) => {
    const log = await service.create(request.body as CreateDietaryLogDTO);
    return reply.status(201).send({ data: log });
  });

  fastify.put(
    '/:id',
    { schema: { ...dietaryParamsSchema, ...updateDietaryLogSchema } },
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const log = await service.update(request.params.id, request.body as UpdateDietaryLogDTO);
      return { data: log };
    }
  );

  fastify.delete(
    '/:id',
    { schema: dietaryParamsSchema },
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      await service.delete(request.params.id);
      return reply.status(204).send();
    }
  );
}
