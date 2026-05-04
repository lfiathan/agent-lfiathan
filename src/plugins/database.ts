import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import knex, { type Knex } from 'knex';
import config from '../config/index.js';

async function databasePlugin(fastify: FastifyInstance): Promise<void> {
  const knexConfig: Knex.Config = {
    client: 'pg',
    connection: {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
    },
    pool: config.database.pool,
  };

  const db = knex(knexConfig);

  // Verify connection
  try {
    await db.raw('SELECT 1');
    fastify.log.info('Database connection established');
  } catch (err) {
    fastify.log.error(err, 'Database connection failed');
    throw err;
  }

  fastify.decorate('knex', db);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing database connection pool');
    await db.destroy();
  });
}

export default fp(databasePlugin, {
  name: 'database',
});
