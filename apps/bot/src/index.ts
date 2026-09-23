import { EnvironmentValidationError, SERVICE_NAMES } from '@yuristim/config';
import { createBot } from './bot.js';
import { loadBotEnv } from './config/env.js';

async function start(): Promise<void> {
  try {
    const env = loadBotEnv();
    const bot = createBot({
      apiBaseUrl: env.API_BASE_URL,
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
