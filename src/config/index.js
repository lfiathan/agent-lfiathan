const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'lfiathan',
    password: process.env.DB_PASSWORD || 'lfiathan_secret',
    name: process.env.DB_NAME || 'agent_lfiathan',
    pool: {
      min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
      max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    },
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'lfiathan:',
    defaultTTL: parseInt(process.env.REDIS_DEFAULT_TTL, 10) || 300, // 5 minutes
  },

  hermes: {
    apiUrl: process.env.HERMES_API_URL || 'http://localhost:8642',
    apiKey: process.env.HERMES_API_KEY || '',
    model: process.env.HERMES_MODEL || 'minimax/minimax-m2.5:free',
    timeout: parseInt(process.env.HERMES_TIMEOUT, 10) || 30000,
  },
};

/** Validate required config in production */
export function validateConfig() {
  const errors = [];

  if (config.env === 'production') {
    if (!config.database.password || config.database.password === 'lfiathan_secret') {
      errors.push('DB_PASSWORD must be set in production');
    }
    if (!config.hermes.apiKey) {
      errors.push('HERMES_API_KEY must be set in production');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}`);
  }
}

export default config;
