import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApprovalService, type ApproveOverrides } from './approval.service.js';
import {
  approvalsByUserSchema,
  approvalParamsSchema,
  approveApprovalSchema,
  type ApprovalStatusInput,
} from './approval.schema.js';

interface IdParams { id: string }
interface UserIdParams { userId: string }
interface ListQuery {
  status?: ApprovalStatusInput;
  limit?: number;
}

export default async function approvalRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ApprovalService(fastify.knex);

  fastify.get(
    '/user/:userId',
    { schema: approvalsByUserSchema },
    async (request: FastifyRequest<{ Params: UserIdParams; Querystring: ListQuery }>) => {
      const approvals = await service.findByUserId(request.params.userId, {
        status: request.query.status,
        limit: request.query.limit,
      });
      return { data: approvals };
    }
  );

  fastify.post(
    '/:id/approve',
    { schema: approveApprovalSchema },
    async (request: FastifyRequest<{ Params: IdParams; Body: ApproveOverrides }>) => {
      const result = await service.approve(request.params.id, request.body ?? {});
      return { data: result };
    }
  );

  fastify.post(
    '/:id/reject',
    { schema: approvalParamsSchema },
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const approval = await service.reject(request.params.id);
      return { data: approval };
    }
  );
}
