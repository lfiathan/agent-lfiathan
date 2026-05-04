import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import type { HermesService } from '../services/hermes.service.js';

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
  hermes: {
    apiUrl: string;
    apiKey: string;
    model: string;
    timeout: number;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    knex: Knex;
    redis: Redis;
    hermes: HermesService;
    config: AppConfig;
  }

  interface FastifyRequest {
    startTime: number;
  }
}
