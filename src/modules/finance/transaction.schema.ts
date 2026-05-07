const TYPES = ['income', 'expense'] as const;

export type TransactionType = (typeof TYPES)[number];

export const createTransactionSchema = {
  body: {
    type: 'object' as const,
    required: ['user_id', 'type', 'amount', 'category'] as const,
    properties: {
      user_id: { type: 'string' as const, format: 'uuid' },
      type: { type: 'string' as const, enum: TYPES },
      amount: { type: 'number' as const, exclusiveMinimum: 0 },
      currency: { type: 'string' as const, minLength: 1, maxLength: 16, default: 'IDR' },
      category: { type: 'string' as const, minLength: 1, maxLength: 100 },
      description: { type: 'string' as const, maxLength: 5000 },
      occurred_at: { type: 'string' as const, format: 'date-time' },
      metadata: { type: 'object' as const, default: {} },
    },
    additionalProperties: false,
  },
};

export const updateTransactionSchema = {
  body: {
    type: 'object' as const,
    properties: {
      type: { type: 'string' as const, enum: TYPES },
      amount: { type: 'number' as const, exclusiveMinimum: 0 },
      currency: { type: 'string' as const, minLength: 1, maxLength: 16 },
      category: { type: 'string' as const, minLength: 1, maxLength: 100 },
      description: { type: 'string' as const, maxLength: 5000 },
      occurred_at: { type: 'string' as const, format: 'date-time' },
      metadata: { type: 'object' as const },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export const transactionParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'] as const,
    properties: {
      id: { type: 'string' as const, format: 'uuid' },
    },
  },
};

export const transactionsByUserSchema = {
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
      type: { type: 'string' as const, enum: TYPES },
      from: { type: 'string' as const, format: 'date-time' },
      to: { type: 'string' as const, format: 'date-time' },
      limit: { type: 'integer' as const, minimum: 1, maximum: 500, default: 100 },
    },
    additionalProperties: false,
  },
};

export const transactionsSummarySchema = {
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
      from: { type: 'string' as const, format: 'date-time' },
      to: { type: 'string' as const, format: 'date-time' },
      currency: { type: 'string' as const, maxLength: 16 },
    },
    additionalProperties: false,
  },
};
