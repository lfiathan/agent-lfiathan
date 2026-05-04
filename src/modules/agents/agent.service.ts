import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import type { HermesService, HermesHealthResult } from '../../services/hermes.service.js';
import { TaskService } from '../tasks/task.service.js';

interface WebhookPayload {
  action: string;
  data: Record<string, unknown>;
  context?: {
    skill?: string;
    session?: string;
  };
}

interface PromptResult {
  content: string;
  structured: Record<string, unknown> | null;
}

export class AgentService {
  private readonly hermes: HermesService;
  private readonly taskService: TaskService;

  constructor(hermes: HermesService, knex: Knex, redis: Redis) {
    this.hermes = hermes;
    this.taskService = new TaskService(knex, redis);
  }

  async prompt(prompt: string, options: { systemPrompt?: string; model?: string } = {}): Promise<PromptResult> {
    const response = await this.hermes.sendMessage(prompt, options);
    const structured = this.hermes.parseStructuredResponse(response.content);
    return { content: response.content, structured };
  }

  async handleWebhook(payload: WebhookPayload): Promise<Record<string, unknown>> {
    const { action, data, context } = payload;

    switch (action) {
      case 'create_task':
        return this.createTaskFromAgent(data, context);

      case 'update_task':
        return this.updateTaskFromAgent(data, context);

      default:
        return { acknowledged: true, action, message: 'No handler for this action' };
    }
  }

  async checkHealth(): Promise<HermesHealthResult> {
    return this.hermes.getHealth();
  }

  private async createTaskFromAgent(
    data: Record<string, unknown>,
    context: WebhookPayload['context'] = {}
  ): Promise<Record<string, unknown>> {
    const task = await this.taskService.create({
      user_id: data.user_id as string,
      title: data.title as string,
      description: (data.description as string) || undefined,
      category: (data.category as string) || 'general',
      source: 'agent',
      agent_metadata: {
        skill: context?.skill || 'unknown',
        session: context?.session || null,
        created_by: 'hermes',
        raw_input: data.raw_input || null,
      },
    });

    return { success: true, task_id: task.id };
  }

  private async updateTaskFromAgent(
    data: Record<string, unknown>,
    context: WebhookPayload['context'] = {}
  ): Promise<Record<string, unknown>> {
    const updateData: Record<string, unknown> = {};
    if (data.status) updateData.status = data.status;
    if (data.title) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;

    const existing = await this.taskService.findById(data.task_id as string);
    updateData.agent_metadata = {
      ...(existing.agent_metadata || {}),
      last_updated_by: 'hermes',
      last_skill: context?.skill || 'unknown',
    };

    const task = await this.taskService.update(data.task_id as string, updateData);
    return { success: true, task_id: task.id };
  }
}
