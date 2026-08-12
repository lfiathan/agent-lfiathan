import type { Knex } from 'knex';

const UNIQUE_INDEX = 'uq_transaction_approvals_source_message';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transaction_approvals', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.string('source_system', 32).notNullable().defaultTo('gmail');
    table.string('source_account', 255).nullable();
    table.string('source_message_id', 512).notNullable();

    // 'pending' until decided, then 'approved' or 'rejected'. Decided rows are
    // what stop the importer restaging the same email on every run.
    table.string('status', 16).notNullable().defaultTo('pending');

    // The staged candidate as the importer read it: amount, currency, type,
    // subject, sender, reference. Kept whole so a decision can be revisited.
    table.jsonb('payload').notNullable().defaultTo('{}');
    table.decimal('confidence', 4, 3).nullable();
    table.text('reason').nullable();

    table.timestamp('decided_at', { useTz: true }).nullable();
    table
      .uuid('transaction_id')
      .nullable()
      .references('id')
      .inTable('transactions')
      .onDelete('SET NULL');

    table.timestamps(true, true);

    table.unique(['source_system', 'source_message_id'], { indexName: UNIQUE_INDEX });
    table.index(['status'], 'idx_transaction_approvals_status');
    table.index(['user_id', 'status'], 'idx_transaction_approvals_user_status');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('transaction_approvals');
}
