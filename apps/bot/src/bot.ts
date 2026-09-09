import { Bot, type Context } from 'grammy';
import { registerDevelopmentHandlers } from './handlers/development.js';
import { YuristimApiClient } from './lib/api-client.js';
import { apiContext } from './middleware/api-context.js';

export interface YuristimBotContext extends Context {
  yuristimApi: YuristimApiClient;
}

export interface CreateBotOptions {
  apiBaseUrl: string;
  internalApiSecret: string;
  token: string;
}

export function createBot(options: CreateBotOptions): Bot<YuristimBotContext> {
  const bot = new Bot<YuristimBotContext>(options.token);
  const api = new YuristimApiClient(options.apiBaseUrl, options.internalApiSecret);

  bot.use(apiContext(api));
  registerDevelopmentHandlers(bot);

  return bot;
}
