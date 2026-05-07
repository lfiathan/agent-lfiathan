const TRAINING_INTENSITIES = ['easy', 'tempo', 'long', 'interval', 'race', 'recovery', 'rest'] as const;

export type TrainingIntensity = (typeof TRAINING_INTENSITIES)[number];

const foodEntrySchema = {
  type: 'object' as const,
  required: ['name'] as const,
  properties: {
    name: { type: 'string' as const, minLength: 1, maxLength: 255 },
    grams: { type: 'number' as const, minimum: 0 },
    calories: { type: 'number' as const, minimum: 0 },
    protein_g: { type: 'number' as const, minimum: 0 },
    carbs_g: { type: 'number' as const, minimum: 0 },
    fat_g: { type: 'number' as const, minimum: 0 },
    meal: { type: 'string' as const, maxLength: 32 }, // 'breakfast', 'lunch', etc.
  },
  additionalProperties: true,
};

export const createDietaryLogSchema = {
  body: {
    type: 'object' as const,
    required: ['user_id', 'log_date'] as const,
    properties: {
      user_id: { type: 'string' as const, format: 'uuid' },
      log_date: { type: 'string' as const, format: 'date' },
      calories: { type: 'integer' as const, minimum: 0, default: 0 },
      protein_g: { type: 'number' as const, minimum: 0, default: 0 },
      carbs_g: { type: 'number' as const, minimum: 0, default: 0 },
      fat_g: { type: 'number' as const, minimum: 0, default: 0 },
      fiber_g: { type: 'number' as const, minimum: 0 },
      water_ml: { type: 'integer' as const, minimum: 0 },

      training_block: { type: 'boolean' as const, default: false },
      training_intensity: { type: 'string' as const, enum: TRAINING_INTENSITIES },
      training_distance_km: { type: 'number' as const, minimum: 0 },
      training_notes: { type: 'string' as const, maxLength: 5000 },

      supplement_creatine: { type: 'boolean' as const, default: false },
      supplement_magnesium: { type: 'boolean' as const, default: false },
      supplement_vitamin_c: { type: 'boolean' as const, default: false },

      food_entries: {
        type: 'array' as const,
        items: foodEntrySchema,
        default: [],
      },
      metadata: { type: 'object' as const, default: {} },
      notes: { type: 'string' as const, maxLength: 5000 },
    },
    additionalProperties: false,
  },
};

export const updateDietaryLogSchema = {
  body: {
    type: 'object' as const,
    properties: {
      calories: { type: 'integer' as const, minimum: 0 },
      protein_g: { type: 'number' as const, minimum: 0 },
      carbs_g: { type: 'number' as const, minimum: 0 },
      fat_g: { type: 'number' as const, minimum: 0 },
      fiber_g: { type: 'number' as const, minimum: 0 },
      water_ml: { type: 'integer' as const, minimum: 0 },

      training_block: { type: 'boolean' as const },
      training_intensity: { type: 'string' as const, enum: TRAINING_INTENSITIES },
      training_distance_km: { type: 'number' as const, minimum: 0 },
      training_notes: { type: 'string' as const, maxLength: 5000 },

      supplement_creatine: { type: 'boolean' as const },
      supplement_magnesium: { type: 'boolean' as const },
      supplement_vitamin_c: { type: 'boolean' as const },

      food_entries: { type: 'array' as const, items: foodEntrySchema },
      metadata: { type: 'object' as const },
      notes: { type: 'string' as const, maxLength: 5000 },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export const dietaryParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'] as const,
    properties: {
      id: { type: 'string' as const, format: 'uuid' },
    },
  },
};

export const dietaryByUserSchema = {
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
      from: { type: 'string' as const, format: 'date' },
      to: { type: 'string' as const, format: 'date' },
      training_only: { type: 'boolean' as const },
      limit: { type: 'integer' as const, minimum: 1, maximum: 365, default: 90 },
    },
    additionalProperties: false,
  },
};

export const dietaryByUserDateSchema = {
  params: {
    type: 'object' as const,
    required: ['userId', 'date'] as const,
    properties: {
      userId: { type: 'string' as const, format: 'uuid' },
      date: { type: 'string' as const, format: 'date' },
    },
  },
};
