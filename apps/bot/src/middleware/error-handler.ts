import type { MiddlewareFn } from 'grammy';
import { YuristimApiError } from '../api/yuristim-api.client.js';
import type { YuristimBotContext } from '../bot.js';
import { t, telegramLanguage } from '../i18n/index.js';

export function safeErrorHandler(): MiddlewareFn<YuristimBotContext> {
  return async (context, next) => {
    try {
      await next();
    } catch (error) {
      const code = error instanceof YuristimApiError ? error.code : 'UNEXPECTED_ERROR';
      console.error({ code, updateId: context.update.update_id }, 'Bot update failed');
      const language = telegramLanguage(context.from?.language_code);
      await context.reply(t(language, code === 'USER_BLOCKED' ? 'blocked' : 'apiError'));
    }
  };
}
