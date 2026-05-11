import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Knex } from 'knex';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
dotenv.config({ path: resolve(root, '.env') });

const connection: Knex.PgConnectionConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const commonConfig: Knex.Config = {
  client: 'pg',
  connection,
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    directory: resolve(root, 'database', 'migrations'),
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: resolve(root, 'database', 'seeds'),
  },
};

export const development: Knex.Config = {
  ...commonConfig,
  debug: false,
};

export const production: Knex.Config = {
  ...commonConfig,
  pool: {
    min: 5,
    max: 30,
  },
};

export default { development, production };
