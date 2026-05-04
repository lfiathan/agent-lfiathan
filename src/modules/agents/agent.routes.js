import { AgentService } from './agent.service.js';

const promptSchema = {
  body: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', minLength: 1, maxLength: 10000 },
      system_prompt: { type: 'string', maxLength: 5000 },
      model: { type: 'string' },
    },
    additionalProperties: false,
  },
};

const webhookSchema = {
  body: {
    type: 'object',
    required: ['action', 'data'],
    properties: {
      action: { type: 'string' },
      data: { type: 'object' },
      context: { type: 'object' },
    },
    additionalProperties: false,
  },
};

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function agentRoutes(fastify) {
  const service = new AgentService(fastify.hermes, fastify.knex, fastify.redis);

  // GET /api/agents/health
  fastify.get('/health', async () => {
    const health = await service.checkHealth();
    return { data: health };
  });

  // POST /api/agents/prompt — send a prompt to Hermes
  fastify.post('/prompt', { schema: promptSchema }, async (request) => {
    const { prompt, system_prompt, model } = request.body;
    const result = await service.prompt(prompt, {
      systemPrompt: system_prompt,
      model,
    });
    return { data: result };
  });

  // POST /api/agents/webhook — receive skill callbacks from Hermes
  fastify.post('/webhook', { schema: webhookSchema }, async (request) => {
    const result = await service.handleWebhook(request.body);
    return { data: result };
  });
}
