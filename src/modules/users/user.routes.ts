import type { FastifyInstance, FastifyRequest } from 'fastify';
import { UserService } from './user.service.js';
import { createUserSchema, updateUserSchema, userParamsSchema } from './user.schema.js';

interface IdParams {
  id: string;
}

export default async function userRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new UserService(fastify.knex, fastify.redis);

  fastify.get('/', async () => {
    const users = await service.findAll();
    return { data: users };
  });

  fastify.get('/:id', { schema: userParamsSchema }, async (request: FastifyRequest<{ Params: IdParams }>) => {
    const user = await service.findById(request.params.id);
    return { data: user };
  });

  fastify.post('/', { schema: createUserSchema }, async (request, reply) => {
    const user = await service.create(request.body as { email: string; name: string; metadata?: Record<string, unknown> });
    return reply.status(201).send({ data: user });
  });

  fastify.put(
    '/:id',
    { schema: { ...userParamsSchema, ...updateUserSchema } },
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const user = await service.update(request.params.id, request.body as Record<string, unknown>);
      return { data: user };
    }
  );

  fastify.delete('/:id', { schema: userParamsSchema }, async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    await service.delete(request.params.id);
    return reply.status(204).send();
  });
}
