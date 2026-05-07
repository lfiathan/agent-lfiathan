import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TransactionService } from './transaction.service.js';
import {
  createTransactionSchema,
  updateTransactionSchema,
  transactionParamsSchema,
  transactionsByUserSchema,
  transactionsSummarySchema,
  type TransactionType,
} from './transaction.schema.js';
import type {
  CreateTransactionDTO,
  UpdateTransactionDTO,
} from './transaction.repository.js';

interface IdParams { id: string }
interface UserIdParams { userId: string }
interface ListQuery {
  type?: TransactionType;
  from?: string;
  to?: string;
  limit?: number;
}
interface SummaryQuery {
  from?: string;
  to?: string;
  currency?: string;
}

export default async function transactionRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new TransactionService(fastify.knex, fastify.redis);

  fastify.get(
    '/user/:userId',
    { schema: transactionsByUserSchema },
    async (request: FastifyRequest<{ Params: UserIdParams; Querystring: ListQuery }>) => {
      const txs = await service.findByUserId(request.params.userId, request.query);
      return { data: txs };
    }
  );

  fastify.get(
    '/user/:userId/summary',
    { schema: transactionsSummarySchema },
    async (request: FastifyRequest<{ Params: UserIdParams; Querystring: SummaryQuery }>) => {
      const summary = await service.summarizeByUser(request.params.userId, request.query);
      return { data: summary };
    }
  );

  fastify.get(
    '/:id',
    { schema: transactionParamsSchema },
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const tx = await service.findById(request.params.id);
      return { data: tx };
    }
  );

  fastify.post('/', { schema: createTransactionSchema }, async (request, reply) => {
    const tx = await service.create(request.body as CreateTransactionDTO);
    return reply.status(201).send({ data: tx });
  });

  fastify.put(
    '/:id',
    { schema: { ...transactionParamsSchema, ...updateTransactionSchema } },
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const tx = await service.update(request.params.id, request.body as UpdateTransactionDTO);
      return { data: tx };
    }
  );

  fastify.delete(
    '/:id',
    { schema: transactionParamsSchema },
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      await service.delete(request.params.id);
      return reply.status(204).send();
    }
  );
}
