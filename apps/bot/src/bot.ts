import { Bot, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { YuristimApiClient, type YuristimApi } from './api/yuristim-api.client.js';
import type { BotRuntimeConfig } from './config/runtime.js';
import { registerCallbackHandler } from './handlers/callback.handler.js';
import { registerMessageHandler } from './handlers/message.handler.js';
import { registerStartHandler } from './handlers/start.handler.js';
import { apiContext } from './middleware/api-context.js';
import { safeErrorHandler } from './middleware/error-handler.js';

export interface YuristimBotContext extends Context {
  botConfig: BotRuntimeConfig;
  yuristimApi: YuristimApi;
}

export interface CreateBotOptions {
  apiBaseUrl: string;
  internalApiSecret: string;
  token: string;
  api?: YuristimApi;
  apiTimeoutMilliseconds?: number;
  privacyUrl?: string;
  publicOfferUrl?: string;
  supportUsername?: string;
  termsVersion?: string;
  botInfo?: UserFromGetMe;
}

export function createBot(options: CreateBotOptions): Bot<YuristimBotContext> {
  const bot = new Bot<YuristimBotContext>(
    options.token,
    options.botInfo ? { botInfo: options.botInfo } : {},
  );
  const api =
    options.api ??
    new YuristimApiClient({
      baseUrl: options.apiBaseUrl,
      internalApiSecret: options.internalApiSecret,
      ...(options.apiTimeoutMilliseconds
        ? { timeoutMilliseconds: options.apiTimeoutMilliseconds }
        : {}),
    });
  const config: BotRuntimeConfig = {
    ...(options.privacyUrl ? { privacyUrl: options.privacyUrl } : {}),
    ...(options.publicOfferUrl ? { publicOfferUrl: options.publicOfferUrl } : {}),
    ...(options.supportUsername ? { supportUsername: options.supportUsername } : {}),
    termsVersion: options.termsVersion ?? '2026-09',
  };

  bot.use(safeErrorHandler());
  bot.use(apiContext(api));
  bot.use(async (context, next) => {
    context.botConfig = config;
    await next();
  });
  registerStartHandler(bot);
  registerCallbackHandler(bot);
  registerMessageHandler(bot);

  return bot;
}
