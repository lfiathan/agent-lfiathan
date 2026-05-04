export const createUserSchema = {
  body: {
    type: 'object' as const,
    required: ['email', 'name'] as const,
    properties: {
      email: { type: 'string' as const, format: 'email', maxLength: 255 },
      name: { type: 'string' as const, minLength: 1, maxLength: 255 },
      metadata: { type: 'object' as const, default: {} },
    },
    additionalProperties: false,
  },
};

export const updateUserSchema = {
  body: {
    type: 'object' as const,
    properties: {
      email: { type: 'string' as const, format: 'email', maxLength: 255 },
      name: { type: 'string' as const, minLength: 1, maxLength: 255 },
      metadata: { type: 'object' as const },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export const userParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'] as const,
    properties: {
      id: { type: 'string' as const, format: 'uuid' },
    },
  },
};
