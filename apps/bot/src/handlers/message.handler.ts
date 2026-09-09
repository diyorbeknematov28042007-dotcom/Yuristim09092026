import type { Composer } from 'grammy';
import type { YuristimBotContext } from '../bot.js';
import { t } from '../i18n/index.js';
import { questionsKeyboard } from '../keyboards/questions.keyboard.js';
import { servicesKeyboard } from '../keyboards/services.keyboard.js';
import { settingsKeyboard } from '../keyboards/settings.keyboard.js';
import { showMainMenu, showOnboardingStep } from '../services/navigation.service.js';
import { validFullName } from '../services/user-context.service.js';

export function registerMessageHandler(composer: Composer<YuristimBotContext>): void {
  composer.on('message:text', async (context) => {
    if (!context.from) return;
    let data = await context.yuristimApi.getTelegramUserContext(context.from.id);
    const language = data.user.language ?? 'uz';
    const message = context.message.text;

    if (data.user.onboardingStatus === 'name_required') {
      const fullName = validFullName(message);
      if (!fullName) {
        await context.reply(t(language, 'nameInvalid'));
        return;
      }
      data = await context.yuristimApi.updateOnboarding(context.from.id, {
        action: 'set_full_name',
        fullName,
      });
      if (data.user.onboardingStatus === 'completed' && data.user.onboardingRole === 'lawyer') {
        await context.reply(t(language, 'lawyerInfo'));
      }
      await showOnboardingStep(context, data, context.botConfig);
      return;
    }
    if (data.user.onboardingStatus !== 'completed') {
      await showOnboardingStep(context, data, context.botConfig);
      return;
    }

    if (message === t(language, 'services')) {
      await context.reply(t(language, 'servicesTitle'), {
        reply_markup: servicesKeyboard(language),
      });
      return;
    }
    if (message === t(language, 'settings')) {
      await context.reply(t(language, 'settingsTitle'), {
        reply_markup: settingsKeyboard(language),
      });
      return;
    }
    if (message === t(language, 'questions')) {
      await context.reply(t(language, 'questionsTitle'), {
        reply_markup: questionsKeyboard(language),
      });
      return;
    }
    if (message === t(language, 'ai')) {
      await context.reply(t(language, 'aiLater'));
      return;
    }
    if (message === t(language, 'balance')) {
      await context.reply(t(language, 'balanceLater'));
      return;
    }
    if (message === t(language, 'marketplace')) {
      await context.reply(t(language, 'featureLater'));
      return;
    }

    await context.reply(t(language, 'unknownMessage'));
    await showMainMenu(context, data);
  });
}
