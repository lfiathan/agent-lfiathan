import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('strava_connections', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.bigint('athlete_id').notNullable();
    table.text('access_token').notNullable();
    table.text('refresh_token').notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.string('scope', 255).notNullable().defaultTo('read,activity:read_all');
    table.string('token_type', 32).notNullable().defaultTo('Bearer');
    table.timestamps(true, true);

    table.unique(['user_id'], { indexName: 'uq_strava_connections_user_id' });
    table.unique(['athlete_id'], { indexName: 'uq_strava_connections_athlete_id' });
    table.index(['expires_at'], 'idx_strava_connections_expires_at');
  });

  await knex.schema.createTable('strava_activities', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.bigint('strava_activity_id').notNullable();
    table.string('name', 255).notNullable();
    table.string('sport_type', 64).notNullable();
    table.decimal('distance_m', 14, 2).notNullable().defaultTo(0);
    table.integer('moving_time_s').notNullable().defaultTo(0);
    table.integer('elapsed_time_s').notNullable().defaultTo(0);
    table.decimal('total_elevation_gain_m', 10, 2).notNullable().defaultTo(0);
    table.timestamp('start_date', { useTz: true }).notNullable();
    table.jsonb('raw').notNullable().defaultTo('{}');
    table.timestamps(true, true);

    table.unique(['strava_activity_id'], { indexName: 'uq_strava_activities_strava_activity_id' });
    table.index(['user_id', 'start_date'], 'idx_strava_activities_user_start_date');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('strava_activities');
  await knex.schema.dropTableIfExists('strava_connections');
}
