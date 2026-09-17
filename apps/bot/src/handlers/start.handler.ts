import type { Composer } from 'grammy';
import type { YuristimBotContext } from '../bot.js';
import { t } from '../i18n/index.js';
import { resumeKeyboard } from '../keyboards/common.keyboard.js';
import { showMainMenu, showOnboardingStep } from '../services/navigation.service.js';
import { telegramIdentity } from '../services/user-context.service.js';
import { showMarketplaceListing } from '../services/marketplace.service.js';

export function parseMarketplaceStartParameter(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parameter = value.trim();
  return /^mp_[a-f0-9]{24}$/.test(parameter) ? parameter : null;
}

export function registerStartHandler(composer: Composer<YuristimBotContext>): void {
  composer.command('start', async (context) => {
    if (!context.from) return;
    const ensured = await context.yuristimApi.ensureTelegramUser(telegramIdentity(context.from));
    if (ensured.user.status === 'blocked') {
      await context.reply(t(ensured.user.language, 'blocked'));
      return;
    }

    const data = await context.yuristimApi.getTelegramUserContext(context.from.id);
    if (data.user.onboardingStatus === 'completed') {
      const deepLink = parseMarketplaceStartParameter(context.match);
      if (deepLink) {
        await showMarketplaceListing(context, data.user.language ?? 'uz', deepLink);
        return;
      }
      await showMainMenu(context, data);
      return;
    }
    if (!ensured.created) {
      const language = data.user.language ?? 'uz';
      await context.reply(t(language, 'resumePrompt'), {
        reply_markup: resumeKeyboard(language),
      });
      return;
    }
    await showOnboardingStep(context, data, context.botConfig);
  });
}
