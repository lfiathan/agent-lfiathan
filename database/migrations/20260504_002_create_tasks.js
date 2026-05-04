/**
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('tasks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.string('title', 255).notNullable();
    table.text('description').nullable();
    table.string('status', 50).notNullable().defaultTo('pending');
    table.string('category', 100).nullable();
    table.string('source', 50).notNullable().defaultTo('api');
    table.jsonb('agent_metadata').notNullable().defaultTo('{}');
    table.timestamp('due_date').nullable();
    table.timestamps(true, true);

    // Indexes for common queries
    table.index('user_id', 'idx_tasks_user_id');
    table.index('status', 'idx_tasks_status');
    table.index('category', 'idx_tasks_category');
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('tasks');
}
