import type { MiddlewareFn } from 'grammy';
import type { YuristimBotContext } from '../bot.js';
import type { YuristimApiClient } from '../lib/api-client.js';

export function apiContext(api: YuristimApiClient): MiddlewareFn<YuristimBotContext> {
  return async (context, next) => {
    context.yuristimApi = api;
    await next();
  };
}
