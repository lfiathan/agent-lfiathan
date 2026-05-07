import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('portfolio_holdings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    // 'fiat' | 'idx_stock' | 'crypto'
    table.string('asset_class', 32).notNullable();
    // Ticker / coin symbol — e.g. 'IDR', 'USD', 'BBCA', 'BTC', 'SOL'
    table.string('symbol', 32).notNullable();
    // Optional human-readable name (e.g. 'Bank Central Asia', 'Bitcoin')
    table.string('name', 255).nullable();

    table.decimal('quantity', 30, 12).notNullable().defaultTo(0);
    // Average cost per unit, in the cost_currency
    table.decimal('average_cost', 30, 12).nullable();
    table.string('cost_currency', 16).notNullable().defaultTo('IDR');

    table.text('notes').nullable();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.timestamps(true, true);

    table.unique(['user_id', 'asset_class', 'symbol'], {
      indexName: 'uq_portfolio_user_asset_symbol',
    });
    table.index('user_id', 'idx_portfolio_user_id');
    table.index('asset_class', 'idx_portfolio_asset_class');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('portfolio_holdings');
}
