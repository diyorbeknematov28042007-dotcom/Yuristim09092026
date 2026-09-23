import { EnvironmentValidationError, SERVICE_NAMES } from '@yuristim/config';
import { createBot } from './bot.js';
import { loadBotEnv } from './config/env.js';

async function start(): Promise<void> {
  try {
    const env = loadBotEnv();
    const bot = createBot({
      apiBaseUrl: env.API_BASE_URL,
      adminTelegramId: env.ADMIN_TELEGRAM_ID,
      apiTimeoutMilliseconds: env.API_TIMEOUT_MILLISECONDS,
      internalApiSecret: env.INTERNAL_BOT_API_SECRET,
      ...(env.PRIVACY_URL ? { privacyUrl: env.PRIVACY_URL } : {}),
      ...(env.PUBLIC_OFFER_URL ? { publicOfferUrl: env.PUBLIC_OFFER_URL } : {}),
      ...(env.SUPPORT_USERNAME ? { supportUsername: env.SUPPORT_USERNAME } : {}),
      termsVersion: env.TERMS_VERSION,
      token: env.TELEGRAM_BOT_TOKEN,
    });

    await bot.start({
      onStart: () => {
        console.info(`${SERVICE_NAMES.bot} started`);
      },
    });
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
