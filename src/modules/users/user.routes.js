import { UserService } from './user.service.js';
import { createUserSchema, updateUserSchema, userParamsSchema } from './user.schema.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function userRoutes(fastify) {
  const service = new UserService(fastify.knex, fastify.redis);

  // GET /api/users
  fastify.get('/', async () => {
    const users = await service.findAll();
    return { data: users };
  });

  // GET /api/users/:id
  fastify.get('/:id', { schema: userParamsSchema }, async (request) => {
    const user = await service.findById(request.params.id);
    return { data: user };
  });

  // POST /api/users
  fastify.post('/', { schema: createUserSchema }, async (request, reply) => {
    const user = await service.create(request.body);
    return reply.status(201).send({ data: user });
  });

  // PUT /api/users/:id
  fastify.put(
    '/:id',
    { schema: { ...userParamsSchema, ...updateUserSchema } },
    async (request) => {
      const user = await service.update(request.params.id, request.body);
      return { data: user };
    }
  );

  // DELETE /api/users/:id
  fastify.delete('/:id', { schema: userParamsSchema }, async (request, reply) => {
    await service.delete(request.params.id);
    return reply.status(204).send();
  });
}
