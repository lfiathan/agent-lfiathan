import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';
import type { Knex } from 'knex';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..', '..');

// Load migrations whose extension matches this file's own: '.ts' when running
// from source, '.js' once compiled. Hardcoding '.js' would break local runs,
// and leaving it unset makes knex treat the emitted .d.ts declarations as
// migrations — they export no up(), so migrate:latest dies on the first one.
const migrationExtension = extname(__filename);
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
    loadExtensions: [migrationExtension],
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
