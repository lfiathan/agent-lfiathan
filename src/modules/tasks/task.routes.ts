import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TaskService } from './task.service.js';
import {
  createTaskSchema,
  updateTaskSchema,
  taskParamsSchema,
  tasksByUserParamsSchema,
} from './task.schema.js';
import type { CreateTaskDTO, UpdateTaskDTO } from './task.repository.js';

interface IdParams { id: string }
interface UserIdParams { userId: string }

export default async function taskRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new TaskService(fastify.knex, fastify.redis);

  fastify.get('/', async () => {
    const tasks = await service.findAll();
    return { data: tasks };
  });

  fastify.get('/:id', { schema: taskParamsSchema }, async (request: FastifyRequest<{ Params: IdParams }>) => {
    const task = await service.findById(request.params.id);
    return { data: task };
  });

  fastify.get(
    '/user/:userId',
    { schema: tasksByUserParamsSchema },
    async (request: FastifyRequest<{ Params: UserIdParams }>) => {
      const tasks = await service.findByUserId(request.params.userId);
      return { data: tasks };
    }
  );

  fastify.post('/', { schema: createTaskSchema }, async (request, reply) => {
    const task = await service.create(request.body as CreateTaskDTO);
    return reply.status(201).send({ data: task });
  });

  fastify.put(
    '/:id',
    { schema: { ...taskParamsSchema, ...updateTaskSchema } },
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const task = await service.update(request.params.id, request.body as UpdateTaskDTO);
      return { data: task };
    }
  );

  fastify.delete('/:id', { schema: taskParamsSchema }, async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    await service.delete(request.params.id);
    return reply.status(204).send();
  });
}
