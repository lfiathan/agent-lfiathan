const TABLE = 'users';

export class UserRepository {
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
   * @param {string} email
   * @returns {Promise<object|undefined>}
   */
  async findByEmail(email) {
    return this.knex(TABLE).where({ email }).first();
  }

  /**
   * @param {object} data
   * @returns {Promise<object>}
   */
  async create(data) {
    const [user] = await this.knex(TABLE).insert(data).returning('*');
    return user;
  }

  /**
   * @param {string} id
   * @param {object} data
   * @returns {Promise<object|undefined>}
   */
  async update(id, data) {
    const [user] = await this.knex(TABLE)
      .where({ id })
      .update({ ...data, updated_at: this.knex.fn.now() })
      .returning('*');
    return user;
  }

  /**
   * @param {string} id
   * @returns {Promise<number>} rows deleted
   */
  async delete(id) {
    return this.knex(TABLE).where({ id }).del();
  }
}
