import type { Composer } from 'grammy';
import type { YuristimBotContext } from '../bot.js';

export function registerDevelopmentHandlers(composer: Composer<YuristimBotContext>): void {
  composer.command('start', async (context) => {
    await context.reply('Yuristim bot foundation ishlamoqda.');
  });
}
