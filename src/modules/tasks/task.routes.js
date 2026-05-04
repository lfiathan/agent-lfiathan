import { TaskService } from './task.service.js';
import {
  createTaskSchema,
  updateTaskSchema,
  taskParamsSchema,
  tasksByUserParamsSchema,
} from './task.schema.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function taskRoutes(fastify) {
  const service = new TaskService(fastify.knex, fastify.redis);

  // GET /api/tasks
  fastify.get('/', async () => {
    const tasks = await service.findAll();
    return { data: tasks };
  });

  // GET /api/tasks/:id
  fastify.get('/:id', { schema: taskParamsSchema }, async (request) => {
    const task = await service.findById(request.params.id);
    return { data: task };
  });

  // GET /api/tasks/user/:userId
  fastify.get(
    '/user/:userId',
    { schema: tasksByUserParamsSchema },
    async (request) => {
      const tasks = await service.findByUserId(request.params.userId);
      return { data: tasks };
    }
  );

  // POST /api/tasks
  fastify.post('/', { schema: createTaskSchema }, async (request, reply) => {
    const task = await service.create(request.body);
    return reply.status(201).send({ data: task });
  });

  // PUT /api/tasks/:id
  fastify.put(
    '/:id',
    { schema: { ...taskParamsSchema, ...updateTaskSchema } },
    async (request) => {
      const task = await service.update(request.params.id, request.body);
      return { data: task };
    }
  );

  // DELETE /api/tasks/:id
  fastify.delete('/:id', { schema: taskParamsSchema }, async (request, reply) => {
    await service.delete(request.params.id);
    return reply.status(204).send();
  });
}
