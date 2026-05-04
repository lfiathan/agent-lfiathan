import { TaskService } from '../tasks/task.service.js';

export class AgentService {
  /**
   * @param {import('../../services/hermes.service.js').HermesService} hermes
   * @param {import('knex').Knex} knex
   * @param {import('ioredis').Redis} redis
   */
  constructor(hermes, knex, redis) {
    this.hermes = hermes;
    this.taskService = new TaskService(knex, redis);
  }

  /**
   * Send a freeform prompt to the agent and return the response.
   * @param {string} prompt
   * @param {object} [options]
   * @returns {Promise<{ content: string, structured: object|null }>}
   */
  async prompt(prompt, options = {}) {
    const response = await this.hermes.sendMessage(prompt, options);
    const structured = this.hermes.parseStructuredResponse(response.content);
    return {
      content: response.content,
      structured,
    };
  }

  /**
   * Process a webhook callback from a Hermes skill.
   * Skills call back to our API when they need to persist data.
   *
   * @param {object} payload
   * @param {string} payload.action - e.g. 'create_task', 'update_task'
   * @param {object} payload.data - Action-specific data
   * @param {object} [payload.context] - Agent context (session, skill name)
   * @returns {Promise<object>}
   */
  async handleWebhook(payload) {
    const { action, data, context } = payload;

    switch (action) {
      case 'create_task':
        return this._createTaskFromAgent(data, context);

      case 'update_task':
        return this._updateTaskFromAgent(data, context);

      default:
        return { acknowledged: true, action, message: 'No handler for this action' };
    }
  }

  /**
   * @param {object} data
   * @param {object} [context]
   */
  async _createTaskFromAgent(data, context = {}) {
    const task = await this.taskService.create({
      user_id: data.user_id,
      title: data.title,
      description: data.description || null,
      category: data.category || 'general',
      source: 'agent',
      agent_metadata: {
        skill: context.skill || 'unknown',
        session: context.session || null,
        created_by: 'hermes',
        raw_input: data.raw_input || null,
      },
    });

    return { success: true, task_id: task.id };
  }

  /**
   * @param {object} data
   * @param {object} [context]
   */
  async _updateTaskFromAgent(data, context = {}) {
    const updateData = {};
    if (data.status) updateData.status = data.status;
    if (data.title) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;

    // Merge agent metadata
    const existing = await this.taskService.findById(data.task_id);
    updateData.agent_metadata = {
      ...existing.agent_metadata,
      last_updated_by: 'hermes',
      last_skill: context.skill || 'unknown',
    };

    const task = await this.taskService.update(data.task_id, updateData);
    return { success: true, task_id: task.id };
  }

  /**
   * Check Hermes health.
   * @returns {Promise<{ available: boolean, details?: any }>}
   */
  async checkHealth() {
    return this.hermes.getHealth();
  }
}
