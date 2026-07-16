require('dotenv').config();

function required(name, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  return v;
}

module.exports = {
  port: process.env.PORT || 4000,
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:4000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  jwtSecret: required('JWT_SECRET', 'dev-secret-change-me'),
  tokenEncryptionKey: required('TOKEN_ENCRYPTION_KEY', 'dev-key-change-me-32-chars-min!!'),

  useQueue: process.env.USE_QUEUE === 'true',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    apiKey: process.env.YOUTUBE_API_KEY || null, // pour la recherche de chaînes (optionnel)
  },
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY,
    clientSecret: process.env.TIKTOK_CLIENT_SECRET,
    redirectUri: process.env.TIKTOK_REDIRECT_URI,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  storageDir: process.env.STORAGE_DIR || './storage',

  email: {
    user: process.env.GMAIL_USER,
    appPassword: process.env.GMAIL_APP_PASSWORD,
    fromName: process.env.EMAIL_FROM_NAME || 'ScaleVid',
  },
};
