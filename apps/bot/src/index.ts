import { EnvironmentValidationError, SERVICE_NAMES } from '@yuristim/config';
import { createBot } from './bot.js';
import { loadBotEnv } from './config/env.js';
import { startBotRunner, stopBotRunner } from './runner.js';

async function start(): Promise<void> {
  try {
    const env = loadBotEnv();
    const bot = createBot({
      apiBaseUrl: env.API_BASE_URL,
      adminTelegramId: env.ADMIN_TELEGRAM_ID,
      apiTimeoutMilliseconds: env.API_TIMEOUT_MILLISECONDS,
      aiApiTimeoutMilliseconds: env.AI_API_TIMEOUT_MILLISECONDS,
      ...(env.TELEGRAM_AI_FAST_STICKER_FILE_ID
        ? { aiFastStickerFileId: env.TELEGRAM_AI_FAST_STICKER_FILE_ID }
        : {}),
      ...(env.TELEGRAM_AI_EXPERT_STICKER_FILE_ID
        ? { aiExpertStickerFileId: env.TELEGRAM_AI_EXPERT_STICKER_FILE_ID }
        : {}),
      ...(env.TELEGRAM_AI_DOCUMENT_STICKER_FILE_ID
        ? { aiDocumentStickerFileId: env.TELEGRAM_AI_DOCUMENT_STICKER_FILE_ID }
        : {}),
      internalApiSecret: env.INTERNAL_BOT_API_SECRET,
      marketplaceChannelId: env.MARKETPLACE_CHANNEL_ID,
      marketplaceChannelUrl: env.MARKETPLACE_CHANNEL_URL,
      ...(env.PRIVACY_URL ? { privacyUrl: env.PRIVACY_URL } : {}),
      ...(env.PUBLIC_OFFER_URL ? { publicOfferUrl: env.PUBLIC_OFFER_URL } : {}),
      ...(env.SUPPORT_USERNAME ? { supportUsername: env.SUPPORT_USERNAME } : {}),
      ...(env.MINI_APP_URL ? { miniAppUrl: env.MINI_APP_URL } : {}),
      termsVersion: env.TERMS_VERSION,
      token: env.TELEGRAM_BOT_TOKEN,
    });

    await bot.init();
    const runner = startBotRunner(bot);
    let stopping = false;
    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
      if (stopping) return;
      stopping = true;
      console.info(`${SERVICE_NAMES.bot} stopping`, { signal });
      await stopBotRunner(runner);
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    console.info(`${SERVICE_NAMES.bot} started`);
    await runner.task();
  } catch (error) {
    const message =
      error instanceof EnvironmentValidationError
        ? error.message
        : `${SERVICE_NAMES.bot} failed to start`;

    console.error(message);
    process.exitCode = 1;
  }
}

void start();
