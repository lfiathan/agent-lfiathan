import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.string('type', 16).notNullable(); // 'income' | 'expense'
    table.decimal('amount', 20, 8).notNullable();
    table.string('currency', 16).notNullable().defaultTo('IDR');
    table.string('category', 100).notNullable();
    table.text('description').nullable();
    table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamps(true, true);

    table.index('user_id', 'idx_transactions_user_id');
    table.index('type', 'idx_transactions_type');
    table.index('occurred_at', 'idx_transactions_occurred_at');
    table.index(['user_id', 'occurred_at'], 'idx_transactions_user_occurred');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('transactions');
}
