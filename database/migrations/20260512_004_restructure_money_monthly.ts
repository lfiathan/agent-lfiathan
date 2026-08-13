import type { Knex } from 'knex';

// Tombstone. Keep it.
//
// This migration was applied in the previous Hermes environment and its file
// was never in the repository, so knex refused to validate the migration list
// without a stand-in. It stays a no-op purely to keep migration history
// consistent — deleting it would break `migrate:latest` on any database that
// already recorded the name.
//
// It creates nothing. The `money` table it once restructured has never existed
// in this database, which is why src/jobs/money-monthly-rollup.job.ts was
// removed: it inserted into a table that was never there. Monthly figures are
// derived from `transactions` instead.
export async function up(_knex: Knex): Promise<void> {
  // no-op
}

export async function down(_knex: Knex): Promise<void> {
  // no-op
}
