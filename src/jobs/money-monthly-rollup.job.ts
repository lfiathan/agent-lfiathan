import 'dotenv/config';

import knex from 'knex';
import config from '../config/index.js';

const TZ = process.env.TZ ?? 'Asia/Jakarta';

async function main(): Promise<void> {
  const db = knex({
    client: 'pg',
    connection: {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
    },
    pool: config.database.pool,
  });

  try {
    const rows = await db.raw(`
      WITH bounds AS (
        SELECT
          date_trunc('month', now() AT TIME ZONE '${TZ}')::date AS period_month,
          (date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}') AS month_start_utc,
          ((date_trunc('month', now() AT TIME ZONE '${TZ}') + interval '1 month') AT TIME ZONE '${TZ}') AS next_month_start_utc
      ),
      agg AS (
        SELECT
          t.user_id,
          COALESCE(NULLIF(t.currency, ''), 'IDR') AS currency,
          b.period_month,
          SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) AS income,
          SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) AS expenses,
          COUNT(*)::int AS tx_count
        FROM transactions t
        CROSS JOIN bounds b
        WHERE t.occurred_at >= b.month_start_utc
          AND t.occurred_at < b.next_month_start_utc
        GROUP BY t.user_id, COALESCE(NULLIF(t.currency, ''), 'IDR'), b.period_month
      )
      INSERT INTO money (user_id, period_month, income, expenses, balance, currency, metadata, created_at, updated_at)
      SELECT
        a.user_id,
        a.period_month,
        a.income,
        a.expenses,
        (a.income - a.expenses) AS balance,
        a.currency,
        jsonb_build_object(
          'source', 'transactions-rollup',
          'timezone', '${TZ}',
          'tx_count', a.tx_count,
          'rolled_up_at', now()
        ) AS metadata,
        now(),
        now()
      FROM agg a
      ON CONFLICT (user_id, period_month)
      DO UPDATE SET
        income = EXCLUDED.income,
        expenses = EXCLUDED.expenses,
        balance = EXCLUDED.balance,
        currency = EXCLUDED.currency,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING user_id, period_month, income, expenses, balance, currency
    `);

    process.stdout.write(
      `${JSON.stringify({
        status: 'ok',
        timezone: TZ,
        rolledUpRows: rows.rows?.length ?? 0,
        rows: rows.rows ?? [],
      })}\n`
    );
  } finally {
    await db.destroy();
  }
}

void main().catch((err) => {
  process.stderr.write(`money-monthly-rollup failed: ${String(err)}\n`);
  process.exit(1);
});
