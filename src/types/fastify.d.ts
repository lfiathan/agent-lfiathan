import type { Knex } from 'knex';
import type { Redis } from 'ioredis';

export interface AppConfig {
  env: string;
  port: number;
  host: string;
  logLevel: string;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    pool: { min: number; max: number };
  };
  redis: {
    url: string;
    keyPrefix: string;
    defaultTTL: number;
  };
  strava: {
    clientId: string;
    clientSecret: string;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    knex: Knex;
    redis: Redis;
    config: AppConfig;
  }

  interface FastifyRequest {
    startTime: number;
  }
}
