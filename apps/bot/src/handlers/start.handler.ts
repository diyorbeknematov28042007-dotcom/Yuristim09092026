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

export function parseLoginStartParameter(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^login_([A-Za-z0-9_-]{43})$/.exec(value.trim())?.[1] ?? null;
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

    const loginChallenge = parseLoginStartParameter(context.match);
    if (loginChallenge) {
      try {
        if (!context.yuristimApi.confirmTelegramLogin)
          throw new Error('Login confirmation unavailable');
        await context.yuristimApi.confirmTelegramLogin(
          loginChallenge,
          telegramIdentity(context.from),
        );
        if (ensured.user.onboardingStatus !== 'completed' || !ensured.user.termsAcceptedAt) {
          await showOnboardingStep(context, { user: ensured.user }, context.botConfig);
          return;
        }
        await context.reply(
          ensured.user.language === 'ru'
            ? 'Вход на сайт подтверждён.'
            : ensured.user.language === 'en'
              ? 'Website sign-in confirmed.'
              : 'Saytga kirish tasdiqlandi.',
        );
      } catch (error) {
        if (!(error instanceof YuristimApiError)) throw error;
        if (error.code === 'USER_BLOCKED') {
          await context.reply(t(ensured.user.language, 'blocked'));
          return;
        }
        const expired =
          error.code === 'LOGIN_CHALLENGE_EXPIRED' || error.code === 'INVALID_LOGIN_CHALLENGE';
        await context.reply(
          ensured.user.language === 'ru'
            ? expired
              ? 'Ссылка устарела. Получите новую на сайте.'
              : 'Не удалось войти. Попробуйте снова.'
            : ensured.user.language === 'en'
              ? expired
                ? 'This link expired. Request a new one on the website.'
                : 'Could not sign in. Please try again.'
              : expired
                ? 'Havola eskirgan. Saytdan yangi havola oling.'
                : 'Hisobga kirib bo‘lmadi. Qayta urinib ko‘ring.',
        );
      }
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
