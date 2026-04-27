export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),

  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
  },

  // Bot Configuration - Solo moderación
  bot: {
    textColor: process.env.TEXT_COLOR,
    moderationEnabled: process.env.MODERATION_ENABLED === 'true',
    autoModerateAll: process.env.AUTO_MODERATE_ALL === 'true',
    autoDeleteMessages: process.env.AUTO_DELETE_MESSAGES === 'true',
    sendModerationWarnings: process.env.SEND_MODERATION_WARNINGS !== 'false',
    personalInfoProtection: process.env.PERSONAL_INFO_PROTECTION !== 'false',
    moderationLevel: process.env.MODERATION_LEVEL || 'STRICT', // STRICT, MODERATE, LENIENT, PRIVACY_ONLY

    // Strikes: when a user accumulates N moderated messages of the configured
    // severity within a rolling time window, the bot issues a temporary ban.
    strikes: {
      threshold: parseInt(process.env.STRIKES_BEFORE_BAN || '3', 10),
      banDuration: process.env.STRIKE_BAN_DURATION || '1h', // '5m' | '1h' | '1d' | '1w' | 'permanent' (legacy fallback)
      windowHours: parseInt(process.env.STRIKE_WINDOW_HOURS || '24', 10),
      countSeverity: (process.env.STRIKE_COUNT_SEVERITY || 'medium').toLowerCase(), // 'high' | 'medium' (counts medium+high) | 'all'
    },

    // Escalating ban ladder. Each successive ban for the same user inside
    // BAN_LADDER_WINDOW_DAYS picks the next rung; once the ladder is
    // exhausted, the last rung is reused.
    banLadder: (process.env.BAN_LADDER || '5m,1h,1d').split(',').map((s) => s.trim()).filter(Boolean),
    banLadderWindowDays: parseInt(process.env.BAN_LADDER_WINDOW_DAYS || '30', 10),

    // Comma-separated list of usernames that bypass moderation entirely.
    // Independent of the chat-role check: useful for trusted regulars who
    // don't have mod/admin role but are known.
    whitelist: (process.env.MOD_WHITELIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

    // In-process LRU cache for LLM decisions, keyed by normalized message text.
    llmCache: {
      ttlMs: parseInt(process.env.LLM_CACHE_TTL_MIN || '5', 10) * 60 * 1000,
      maxEntries: parseInt(process.env.LLM_CACHE_MAX || '1000', 10),
    },

    // Reputation: when enabled, users with no strikes in the last
    // REPUTATION_DAYS receive a "good history" hint to the LLM that biases
    // it toward allow.
    reputation: {
      enabled: process.env.REPUTATION_ENABLED !== 'false',
      windowDays: parseInt(process.env.REPUTATION_DAYS || '7', 10),
    },
  },

  // Connection to the chat backend (E:\Dev\chat\backend)
  chat: {
    apiUrl: process.env.CHAT_API_URL || 'http://localhost:3001',
    apiKey: process.env.CHAT_API_KEY || '',
  },

  // MongoDB — same DB the chat backend uses; collections are prefixed mod_*
  // to keep moderator data separate.
  database: {
    uri: process.env.MONGODB_URI || '',
  },
});
