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
    moderationOnlyMode: process.env.MODERATION_ONLY_MODE === 'true',
    sendModerationWarnings: process.env.SEND_MODERATION_WARNINGS !== 'false',
    personalInfoProtection: process.env.PERSONAL_INFO_PROTECTION !== 'false',
    moderationLevel: process.env.MODERATION_LEVEL || 'STRICT', // STRICT, MODERATE, LENIENT, PRIVACY_ONLY
    toxicityThreshold: parseFloat(process.env.TOXICITY_THRESHOLD || '0.7'), // 0.0 - 1.0
    contextAwareness: process.env.CONTEXT_AWARENESS !== 'false',
  },

  // Connection to the chat backend (E:\Dev\chat\backend)
  chat: {
    apiUrl: process.env.CHAT_API_URL || 'http://localhost:3001',
    apiKey: process.env.CHAT_API_KEY || '',
  },
});
