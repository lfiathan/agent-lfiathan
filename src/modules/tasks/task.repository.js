const TABLE = 'tasks';

export class TaskRepository {
  /** @param {import('knex').Knex} knex */
  constructor(knex) {
    this.knex = knex;
  }

  /** @returns {Promise<Array>} */
  async findAll() {
    return this.knex(TABLE).select('*').orderBy('created_at', 'desc');
  }

  /**
   * @param {string} id
   * @returns {Promise<object|undefined>}
   */
  async findById(id) {
    return this.knex(TABLE).where({ id }).first();
  }

  /**
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async findByUserId(userId) {
    return this.knex(TABLE)
      .where({ user_id: userId })
      .orderBy('created_at', 'desc');
  }

  /**
   * @param {object} data
   * @returns {Promise<object>}
   */
  async create(data) {
    const [task] = await this.knex(TABLE).insert(data).returning('*');
    return task;
  }

  /**
   * @param {string} id
   * @param {object} data
   * @returns {Promise<object|undefined>}
   */
  async update(id, data) {
    const [task] = await this.knex(TABLE)
      .where({ id })
      .update({ ...data, updated_at: this.knex.fn.now() })
      .returning('*');
    return task;
  }

  /**
   * @param {string} id
   * @returns {Promise<number>} rows deleted
   */
  async delete(id) {
    return this.knex(TABLE).where({ id }).del();
  }
}
