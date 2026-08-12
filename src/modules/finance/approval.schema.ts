const STATUSES = ['pending', 'approved', 'rejected'] as const;
const TYPES = ['income', 'expense', 'transfer'] as const;

export type ApprovalStatusInput = (typeof STATUSES)[number];

export const approvalsByUserSchema = {
  params: {
    type: 'object' as const,
    required: ['userId'] as const,
    properties: {
      userId: { type: 'string' as const, format: 'uuid' },
    },
  },
  querystring: {
    type: 'object' as const,
    properties: {
      status: { type: 'string' as const, enum: STATUSES, default: 'pending' },
      limit: { type: 'integer' as const, minimum: 1, maximum: 500, default: 100 },
    },
    additionalProperties: false,
  },
};

export const approvalParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'] as const,
    properties: {
      id: { type: 'string' as const, format: 'uuid' },
    },
  },
};

export const approveApprovalSchema = {
  ...approvalParamsSchema,
  body: {
    type: 'object' as const,
    // Every field optional: approving unchanged is the common case, and the
    // overrides exist to correct what made the candidate need review.
    properties: {
      amount: { type: 'number' as const, exclusiveMinimum: 0 },
      currency: { type: 'string' as const, minLength: 3, maxLength: 16 },
      inferredType: { type: 'string' as const, enum: TYPES },
      category: { type: 'string' as const, minLength: 1, maxLength: 100 },
      occurredAt: { type: 'string' as const, format: 'date-time' },
    },
    additionalProperties: false,
  },
};
