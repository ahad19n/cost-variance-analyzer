require('dotenv').config({ quiet: true });

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || (env === 'test' ? ':memory:' : 'data/app.db'),
  sessionSecret: process.env.SESSION_SECRET,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  upload: {
    maxBytes: 2 * 1024 * 1024,
    maxRows: 5000,
  },
  llm: {
    baseURL: process.env.LITELLM_BASE_URL || '',
    apiKey: process.env.LITELLM_API_KEY || '',
    model: process.env.LITELLM_MODEL || '',
    timeoutMs: Number(process.env.LITELLM_TIMEOUT_MS) || 20000,
  },
};

if (!config.sessionSecret) {
  if (config.isProd) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  config.sessionSecret = 'dev-only-insecure-secret-change-me';
}

module.exports = config;
