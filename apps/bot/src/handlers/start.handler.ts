import type { Composer } from 'grammy';
import type { YuristimBotContext } from '../bot.js';
import { YuristimApiError } from '../api/yuristim-api.client.js';
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

export function parseFounding100StartParameter(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parameter = value.trim();
  const match = /^f100_([A-Za-z0-9_-]{43})$/.exec(parameter);
  return match?.[1] ?? null;
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

    const founding100Token = parseFounding100StartParameter(context.match);
    if (founding100Token) {
      try {
        await context.yuristimApi.confirmFounding100(context.from.id, founding100Token);
        await context.reply(t(ensured.user.language, 'founding100Confirmed'));
      } catch (error) {
        if (
          error instanceof YuristimApiError &&
          (error.code === 'FOUNDING100_RESERVATION_EXPIRED' ||
            error.code === 'FOUNDING100_RESERVATION_NOT_FOUND')
        ) {
          await context.reply(t(ensured.user.language, 'founding100Expired'));
          return;
        }
        throw error;
      }
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
