import type { Knex } from 'knex';

const TABLE = 'transactions';
const UNIQUE_INDEX = 'uq_transactions_source_fingerprint';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE, (table) => {
    table.string('source_system', 32).nullable();
    table.string('source_account', 255).nullable();
    table.string('source_message_id', 512).nullable();
    table.string('source_fingerprint', 128).nullable();
  });

  await knex.schema.alterTable(TABLE, (table) => {
    table.unique(['source_fingerprint'], {
      indexName: UNIQUE_INDEX,
      predicate: knex.whereNotNull('source_fingerprint'),
    });
    table.index(['source_system', 'source_account'], 'idx_transactions_source_system_account');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE, (table) => {
    table.dropIndex(['source_system', 'source_account'], 'idx_transactions_source_system_account');
    table.dropUnique(['source_fingerprint'], UNIQUE_INDEX);
    table.dropColumn('source_fingerprint');
    table.dropColumn('source_message_id');
    table.dropColumn('source_account');
    table.dropColumn('source_system');
  });
}
