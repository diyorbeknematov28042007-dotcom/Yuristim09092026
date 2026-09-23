import type { MiddlewareFn } from 'grammy';
import type { YuristimBotContext } from '../bot.js';
import type { YuristimApi } from '../api/yuristim-api.client.js';

export function apiContext(api: YuristimApi): MiddlewareFn<YuristimBotContext> {
  return async (context, next) => {
    context.yuristimApi = api;
    await next();
  };
}
