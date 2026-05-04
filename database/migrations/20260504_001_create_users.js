/**
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // Enable uuid generation
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email', 255).notNullable().unique();
    table.string('name', 255).notNullable();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamps(true, true); // created_at, updated_at with defaults
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('users');
}
