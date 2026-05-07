const ASSET_CLASSES = ['fiat', 'idx_stock', 'crypto'] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

export const createHoldingSchema = {
  body: {
    type: 'object' as const,
    required: ['user_id', 'asset_class', 'symbol', 'quantity'] as const,
    properties: {
      user_id: { type: 'string' as const, format: 'uuid' },
      asset_class: { type: 'string' as const, enum: ASSET_CLASSES },
      symbol: { type: 'string' as const, minLength: 1, maxLength: 32 },
      name: { type: 'string' as const, maxLength: 255 },
      quantity: { type: 'number' as const, minimum: 0 },
      average_cost: { type: 'number' as const, minimum: 0 },
      cost_currency: { type: 'string' as const, minLength: 1, maxLength: 16, default: 'IDR' },
      notes: { type: 'string' as const, maxLength: 5000 },
      metadata: { type: 'object' as const, default: {} },
    },
    additionalProperties: false,
  },
};

export const updateHoldingSchema = {
  body: {
    type: 'object' as const,
    properties: {
      name: { type: 'string' as const, maxLength: 255 },
      quantity: { type: 'number' as const, minimum: 0 },
      average_cost: { type: 'number' as const, minimum: 0 },
      cost_currency: { type: 'string' as const, minLength: 1, maxLength: 16 },
      notes: { type: 'string' as const, maxLength: 5000 },
      metadata: { type: 'object' as const },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export const adjustHoldingSchema = {
  body: {
    type: 'object' as const,
    required: ['delta'] as const,
    properties: {
      delta: { type: 'number' as const },
      average_cost: { type: 'number' as const, minimum: 0 },
    },
    additionalProperties: false,
  },
};

export const holdingParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'] as const,
    properties: {
      id: { type: 'string' as const, format: 'uuid' },
    },
  },
};

export const portfolioByUserSchema = {
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
      asset_class: { type: 'string' as const, enum: ASSET_CLASSES },
    },
    additionalProperties: false,
  },
};
