import type { MiddlewareFn } from 'grammy';
import type { YuristimBotContext } from '../bot.js';
import { t, telegramLanguage } from '../i18n/index.js';
import { parseCallbackData } from '../types/callback.js';
import { elapsedBotMilliseconds, recordBotPerformance } from '../observability/performance.js';

export function acknowledgeCallback(): MiddlewareFn<YuristimBotContext> {
  return async (context, next) => {
    if (context.callbackQuery?.data !== undefined) {
      const valid = Boolean(parseCallbackData(context.callbackQuery.data) && context.from);
      let success = false;
      try {
        await context.answerCallbackQuery(
          valid
            ? {}
            : {
                show_alert: true,
                text: t(telegramLanguage(context.from?.language_code), 'invalidAction'),
              },
        );
        success = true;
      } catch {
        // An expired callback acknowledgement must not abort the ordered action.
      } finally {
        recordBotPerformance('callback_ack', {
          durationMilliseconds: elapsedBotMilliseconds(),
          success,
        });
      }
      if (!valid) return;
    }
    await next();
  };
}
