const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
const SOURCES = ['api', 'agent', 'telegram'] as const;

export type TaskStatus = (typeof STATUSES)[number];
export type TaskSource = (typeof SOURCES)[number];

export const createTaskSchema = {
  body: {
    type: 'object' as const,
    required: ['user_id', 'title'] as const,
    properties: {
      user_id: { type: 'string' as const, format: 'uuid' },
      title: { type: 'string' as const, minLength: 1, maxLength: 255 },
      description: { type: 'string' as const, maxLength: 5000 },
      status: { type: 'string' as const, enum: STATUSES, default: 'pending' },
      category: { type: 'string' as const, maxLength: 100 },
      source: { type: 'string' as const, enum: SOURCES, default: 'api' },
      agent_metadata: { type: 'object' as const, default: {} },
      due_date: { type: 'string' as const, format: 'date-time', nullable: true },
    },
    additionalProperties: false,
  },
};

export const updateTaskSchema = {
  body: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const, minLength: 1, maxLength: 255 },
      description: { type: 'string' as const, maxLength: 5000 },
      status: { type: 'string' as const, enum: STATUSES },
      category: { type: 'string' as const, maxLength: 100 },
      agent_metadata: { type: 'object' as const },
      due_date: { type: 'string' as const, format: 'date-time', nullable: true },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export const taskParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'] as const,
    properties: {
      id: { type: 'string' as const, format: 'uuid' },
    },
  },
};

export const tasksByUserParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['userId'] as const,
    properties: {
      userId: { type: 'string' as const, format: 'uuid' },
    },
  },
};
