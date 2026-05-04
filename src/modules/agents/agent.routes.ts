import type { FastifyInstance } from 'fastify';
import { AgentService } from './agent.service.js';

const promptSchema = {
  body: {
    type: 'object' as const,
    required: ['prompt'] as const,
    properties: {
      prompt: { type: 'string' as const, minLength: 1, maxLength: 10000 },
      system_prompt: { type: 'string' as const, maxLength: 5000 },
      model: { type: 'string' as const },
    },
    additionalProperties: false,
  },
};

const webhookSchema = {
  body: {
    type: 'object' as const,
    required: ['action', 'data'] as const,
    properties: {
      action: { type: 'string' as const },
      data: { type: 'object' as const },
      context: { type: 'object' as const },
    },
    additionalProperties: false,
  },
};

interface PromptBody {
  prompt: string;
  system_prompt?: string;
  model?: string;
}

interface WebhookBody {
  action: string;
  data: Record<string, unknown>;
  context?: { skill?: string; session?: string };
}

export default async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new AgentService(fastify.hermes, fastify.knex, fastify.redis);

  fastify.get('/health', async () => {
    const health = await service.checkHealth();
    return { data: health };
  });

  fastify.post<{ Body: PromptBody }>('/prompt', { schema: promptSchema }, async (request) => {
    const { prompt, system_prompt, model } = request.body;
    const result = await service.prompt(prompt, { systemPrompt: system_prompt, model });
    return { data: result };
  });

  fastify.post<{ Body: WebhookBody }>('/webhook', { schema: webhookSchema }, async (request) => {
    const result = await service.handleWebhook(request.body);
    return { data: result };
  });
}
