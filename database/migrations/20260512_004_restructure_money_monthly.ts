import type { Knex } from 'knex';

// NOTE:
// This migration has already been applied in this environment and was missing from disk,
// which caused Knex migration validation to fail.
// We keep a no-op definition here to preserve migration history consistency.
export async function up(_knex: Knex): Promise<void> {
  // no-op
}

export async function down(_knex: Knex): Promise<void> {
  // no-op
}
