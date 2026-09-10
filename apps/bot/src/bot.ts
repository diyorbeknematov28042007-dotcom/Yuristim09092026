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
  downloadTelegramFile: (
    fileId: string,
    contentType: string,
    originalFilename: string,
  ) => Promise<{
    base64: string;
    contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
    originalFilename: string;
  }>;
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
  adminTelegramId?: number;
  fetch?: typeof fetch;
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
    ...(options.adminTelegramId ? { adminTelegramId: options.adminTelegramId } : {}),
    ...(options.privacyUrl ? { privacyUrl: options.privacyUrl } : {}),
    ...(options.publicOfferUrl ? { publicOfferUrl: options.publicOfferUrl } : {}),
    ...(options.supportUsername ? { supportUsername: options.supportUsername } : {}),
    termsVersion: options.termsVersion ?? '2026-09',
  };

  bot.use(safeErrorHandler());
  bot.use(apiContext(api));
  bot.use(async (context, next) => {
    context.botConfig = config;
    context.downloadTelegramFile = async (fileId, contentType, originalFilename) => {
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(contentType))
        throw new Error('Unsupported Telegram file type');
      const file = await bot.api.getFile(fileId);
      if (!file.file_path || (file.file_size !== undefined && file.file_size > 5 * 1024 * 1024))
        throw new Error('Telegram file is unavailable');
      const response = await (options.fetch ?? fetch)(
        `https://api.telegram.org/file/bot${options.token}/${file.file_path}`,
      );
      if (!response.ok) throw new Error('Telegram file download failed');
      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > 5 * 1024 * 1024) throw new Error('Telegram file is too large');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024)
        throw new Error('Telegram file is invalid');
      return {
        base64: Buffer.from(bytes).toString('base64'),
        contentType: contentType as 'application/pdf' | 'image/jpeg' | 'image/png',
        originalFilename,
      };
    };
    await next();
  });
  registerStartHandler(bot);
  registerCallbackHandler(bot);
  registerMessageHandler(bot);

  return bot;
}
