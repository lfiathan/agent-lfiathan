import fp from 'fastify-plugin';
import knex from 'knex';
import config from '../config/index.js';

async function databasePlugin(fastify) {
  const knexConfig = {
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
