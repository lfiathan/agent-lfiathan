import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dietary_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.date('log_date').notNullable();

    // Daily totals
    table.integer('calories').notNullable().defaultTo(0);
    table.decimal('protein_g', 8, 2).notNullable().defaultTo(0);
    table.decimal('carbs_g', 8, 2).notNullable().defaultTo(0);
    table.decimal('fat_g', 8, 2).notNullable().defaultTo(0);
    table.decimal('fiber_g', 8, 2).nullable();
    table.integer('water_ml').nullable();

    // Marathon training context
    table.boolean('training_block').notNullable().defaultTo(false);
    table.string('training_intensity', 32).nullable(); // 'easy' | 'tempo' | 'long' | 'race' | etc.
    table.decimal('training_distance_km', 8, 2).nullable();
    table.text('training_notes').nullable();

    // Daily supplement routine
    table.boolean('supplement_creatine').notNullable().defaultTo(false);
    table.boolean('supplement_magnesium').notNullable().defaultTo(false);
    table.boolean('supplement_vitamin_c').notNullable().defaultTo(false);

    // Free-form structured payload (food entries, additional supplements, etc.)
    table.jsonb('food_entries').notNullable().defaultTo('[]');
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.text('notes').nullable();

    table.timestamps(true, true);

    table.unique(['user_id', 'log_date'], { indexName: 'uq_dietary_user_date' });
    table.index('user_id', 'idx_dietary_user_id');
    table.index('log_date', 'idx_dietary_log_date');
    table.index('training_block', 'idx_dietary_training_block');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('dietary_logs');
}
