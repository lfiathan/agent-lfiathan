import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

const connection = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const commonConfig = {
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

/** @type {import('knex').Knex.Config} */
export const development = {
  ...commonConfig,
  debug: false,
};

/** @type {import('knex').Knex.Config} */
export const production = {
  ...commonConfig,
  pool: {
    min: 5,
    max: 30,
  },
};

export default { development, production };
