const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const SOURCES = ['api', 'agent', 'telegram'];

export const createTaskSchema = {
  body: {
    type: 'object',
    required: ['user_id', 'title'],
    properties: {
      user_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 5000 },
      status: { type: 'string', enum: STATUSES, default: 'pending' },
      category: { type: 'string', maxLength: 100 },
      source: { type: 'string', enum: SOURCES, default: 'api' },
      agent_metadata: { type: 'object', default: {} },
      due_date: { type: 'string', format: 'date-time', nullable: true },
    },
    additionalProperties: false,
  },
};

export const updateTaskSchema = {
  body: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 5000 },
      status: { type: 'string', enum: STATUSES },
      category: { type: 'string', maxLength: 100 },
      agent_metadata: { type: 'object' },
      due_date: { type: 'string', format: 'date-time', nullable: true },
    },
    additionalProperties: false,
    minProperties: 1,
  },
};

export const taskParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
};

export const tasksByUserParamsSchema = {
  params: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
    },
  },
};
