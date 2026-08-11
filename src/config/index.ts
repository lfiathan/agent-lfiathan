import type { AppConfig } from '../types/fastify.js';

function parseAgentApiKeys(): AppConfig['agentApiKeys'] {
  const raw = process.env.AGENT_API_KEYS;
  if (!raw) return {};

  try {
    return JSON.parse(raw) as AppConfig['agentApiKeys'];
  } catch {
    throw new Error('AGENT_API_KEYS must be valid JSON, e.g. {"finance":{"key":"...","scopes":["/api/transactions"]}}');
  }
}

const config: AppConfig = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER || 'lfiathan',
    password: process.env.DB_PASSWORD || 'lfiathan_secret',
    name: process.env.DB_NAME || 'agent_lfiathan',
    pool: {
      min: parseInt(process.env.DB_POOL_MIN ?? '2', 10),
      max: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
    },
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'lfiathan:',
    defaultTTL: parseInt(process.env.REDIS_DEFAULT_TTL ?? '300', 10),
  },

  strava: {
    clientId: process.env.STRAVA_CLIENT_ID || '',
    clientSecret: process.env.STRAVA_CLIENT_SECRET || '',
    webhookVerifyToken: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || process.env.STRAVA_ANALYSIS_WEBHOOK_VERIFY_TOKEN || '',
    analysisTelegramBotToken: process.env.STRAVA_ANALYSIS_TELEGRAM_BOT_TOKEN || '',
    analysisTelegramChatId: process.env.STRAVA_ANALYSIS_TELEGRAM_CHAT_ID || '',
  },

  agentApiKeys: parseAgentApiKeys(),
};

/** Validate required config in production */
export function validateConfig(): void {
  const errors: string[] = [];

  if (config.env === 'production') {
    if (!config.database.password || config.database.password === 'lfiathan_secret') {
      errors.push('DB_PASSWORD must be set in production');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}`);
  }
}

export default config;
