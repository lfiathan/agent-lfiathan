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

export const webhookVerifyQuerySchema = {
  querystring: {
    type: 'object' as const,
    required: ['hub.mode', 'hub.verify_token', 'hub.challenge'] as const,
    properties: {
      'hub.mode': { type: 'string' as const },
      'hub.verify_token': { type: 'string' as const },
      'hub.challenge': { type: 'string' as const },
    },
    additionalProperties: true,
  },
};

export const webhookEventBodySchema = {
  body: {
    type: 'object' as const,
    required: ['object_type', 'object_id', 'aspect_type', 'owner_id'] as const,
    properties: {
      object_type: { type: 'string' as const },
      object_id: { type: 'integer' as const },
      aspect_type: { type: 'string' as const },
      owner_id: { type: 'integer' as const },
      event_time: { type: 'integer' as const },
      subscription_id: { type: 'integer' as const },
      updates: { type: 'object' as const, additionalProperties: true },
    },
    additionalProperties: true,
  },
};
