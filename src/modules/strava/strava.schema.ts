export const connectQuerySchema = {
  querystring: {
    type: 'object' as const,
    required: ['userId'] as const,
    properties: {
      userId: { type: 'string' as const, format: 'uuid' },
      redirectUri: { type: 'string' as const, format: 'uri' },
      scope: { type: 'string' as const, minLength: 1, maxLength: 255 },
    },
    additionalProperties: false,
  },
};

export const callbackBodySchema = {
  body: {
    type: 'object' as const,
    required: ['userId', 'code'] as const,
    properties: {
      userId: { type: 'string' as const, format: 'uuid' },
      code: { type: 'string' as const, minLength: 1 },
      redirectUri: { type: 'string' as const, format: 'uri' },
    },
    additionalProperties: false,
  },
};

export const userParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['userId'] as const,
    properties: {
      userId: { type: 'string' as const, format: 'uuid' },
    },
  },
};

export const syncBodySchema = {
  body: {
    type: 'object' as const,
    properties: {
      page: { type: 'integer' as const, minimum: 1, default: 1 },
      perPage: { type: 'integer' as const, minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
};
