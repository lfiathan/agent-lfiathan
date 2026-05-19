import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('strava_activity_notifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.bigint('strava_activity_id').notNullable();
    table.string('event_type', 32).notNullable().defaultTo('create');
    table.timestamp('notified_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.jsonb('payload').notNullable().defaultTo('{}');
    table.timestamps(true, true);

    table.unique(['strava_activity_id', 'event_type'], {
      indexName: 'uq_strava_activity_notifications_activity_event',
    });
    table.index(['user_id', 'notified_at'], 'idx_strava_activity_notifications_user_notified');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('strava_activity_notifications');
}
