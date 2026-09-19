import type { Composer } from 'grammy';
import type { YuristimBotContext } from '../bot.js';
import { t } from '../i18n/index.js';
import { resumeKeyboard } from '../keyboards/common.keyboard.js';
import { showMainMenu, showOnboardingStep } from '../services/navigation.service.js';
import { telegramIdentity } from '../services/user-context.service.js';
import { showMarketplaceListing } from '../services/marketplace.service.js';
import { elapsedBotMilliseconds, recordBotPerformance } from '../observability/performance.js';

export function parseMarketplaceStartParameter(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parameter = value.trim();
  return /^mp_[a-f0-9]{24}$/.test(parameter) ? parameter : null;
}

export function registerStartHandler(composer: Composer<YuristimBotContext>): void {
  composer.command('start', async (context) => {
    if (!context.from) return;
    const ensured = await context.yuristimApi.ensureTelegramUser(telegramIdentity(context.from));
    recordBotPerformance('bot_context_ready', {
      durationMilliseconds: elapsedBotMilliseconds(),
    });
    if (ensured.user.status === 'blocked') {
      await context.reply(t(ensured.user.language, 'blocked'));
      return;
    }

    const data = { user: ensured.user };
    if (ensured.user.onboardingStatus === 'completed') {
      const deepLink = parseMarketplaceStartParameter(context.match);
      if (deepLink) {
        await showMarketplaceListing(context, ensured.user.language ?? 'uz', deepLink);
        return;
      }
      await showMainMenu(context, data);
      return;
    }
    if (!ensured.created) {
      const language = ensured.user.language ?? 'uz';
      await context.reply(t(language, 'resumePrompt'), {
        reply_markup: resumeKeyboard(language),
      });
      return;
    }
    await showOnboardingStep(context, data, context.botConfig);
  });
}
