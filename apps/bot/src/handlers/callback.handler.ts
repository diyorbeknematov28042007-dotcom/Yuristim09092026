import type { Language, UserRole } from '@yuristim/types';
import type { Composer } from 'grammy';
import type { YuristimBotContext } from '../bot.js';
import { t, telegramLanguage } from '../i18n/index.js';
import { languageKeyboard, roleKeyboard } from '../keyboards/common.keyboard.js';
import { questionsKeyboard } from '../keyboards/questions.keyboard.js';
import { servicesKeyboard } from '../keyboards/services.keyboard.js';
import { settingsKeyboard } from '../keyboards/settings.keyboard.js';
import {
  aboutText,
  editOrReply,
  profileText,
  shellBack,
  showMainMenu,
  showOnboardingStep,
} from '../services/navigation.service.js';
import {
  showLawyerProfile,
  showVerificationStep,
} from '../services/lawyer-verification.service.js';
import { parseCallbackData } from '../types/callback.js';

export function registerCallbackHandler(composer: Composer<YuristimBotContext>): void {
  composer.on('callback_query:data', async (context) => {
    const callback = parseCallbackData(context.callbackQuery.data);
    if (!callback || !context.from) {
      await context.answerCallbackQuery({
        show_alert: true,
        text: t(telegramLanguage(context.from?.language_code), 'invalidAction'),
      });
      return;
    }
    await context.answerCallbackQuery();

    let data = await context.yuristimApi.getTelegramUserContext(context.from.id);
    let language = data.user.language ?? telegramLanguage(context.from.language_code);

    if (callback.startsWith('lang:')) {
      language = callback.slice(5) as Language;
      data = await context.yuristimApi.updateOnboarding(context.from.id, {
        action: 'set_language',
        language,
      });
      if (data.user.onboardingStatus === 'completed') {
        await editOrReply(context, t(language, 'languageChanged'), {
          reply_markup: settingsKeyboard(language),
        });
      } else {
        await showOnboardingStep(context, data, context.botConfig);
      }
      return;
    }

    if (callback.startsWith('role:')) {
      const role = callback.slice(5) as UserRole;
      data = await context.yuristimApi.updateOnboarding(context.from.id, {
        action: 'set_role',
        role,
      });
      if (data.user.onboardingStatus === 'completed') {
        await editOrReply(
          context,
          role === 'lawyer' ? t(language, 'lawyerModeLocked') : t(language, 'roleChanged'),
        );
        await showMainMenu(context, data);
      } else {
        await showOnboardingStep(context, data, context.botConfig);
      }
      return;
    }

    if (callback === 'onboarding:continue') {
      await showOnboardingStep(context, data, context.botConfig);
      return;
    }
    if (callback === 'onboarding:reset') {
      data = await context.yuristimApi.updateOnboarding(context.from.id, { action: 'reset' });
      await showOnboardingStep(context, data, context.botConfig);
      return;
    }
    if (callback === 'terms:accept') {
      data = await context.yuristimApi.updateOnboarding(context.from.id, {
        action: 'accept_terms',
        termsVersion: context.botConfig.termsVersion,
      });
      language = data.user.language ?? 'uz';
      await editOrReply(context, t(language, 'onboardingComplete'));
      if (data.user.onboardingRole === 'lawyer') {
        await context.reply(t(language, 'lawyerInfo'));
        await showLawyerProfile(context, language);
      }
      await showMainMenu(context, data);
      return;
    }

    if (callback === 'nav:main') {
      await showMainMenu(context, data);
      return;
    }
    if (callback === 'nav:services') {
      await editOrReply(context, t(language, 'servicesTitle'), {
        reply_markup: servicesKeyboard(language),
      });
      return;
    }
    if (callback === 'nav:settings') {
      await editOrReply(context, t(language, 'settingsTitle'), {
        reply_markup: settingsKeyboard(language),
      });
      return;
    }
    if (callback === 'nav:questions') {
      await editOrReply(context, t(language, 'questionsTitle'), {
        reply_markup: questionsKeyboard(language),
      });
      return;
    }
    if (callback === 'nav:ai') {
      await editOrReply(context, t(language, 'aiLater'));
      return;
    }
    if (callback === 'nav:balance') {
      await editOrReply(context, t(language, 'balanceLater'));
      return;
    }

    if (callback === 'verify:start' || callback === 'verify:edit') {
      if (callback === 'verify:edit')
        await editOrReply(context, t(language, 'profileChangeWarning'));
      const verification = await context.yuristimApi.updateVerification(context.from.id, {
        action: 'start',
        type: callback === 'verify:edit' ? 'profile_update' : 'initial',
      });
      await showVerificationStep(context, language, verification);
      return;
    }
    if (callback === 'verify:back') {
      const verification = await context.yuristimApi.updateVerification(context.from.id, {
        action: 'back',
      });
      await showVerificationStep(context, language, verification);
      return;
    }
    if (callback === 'verify:cancel') {
      await context.yuristimApi.updateVerification(context.from.id, { action: 'cancel' });
      await editOrReply(context, t(language, 'verificationCancelled'));
      await showLawyerProfile(context, language);
      return;
    }
    if (callback.startsWith('verify:spec:')) {
      const verification = await context.yuristimApi.updateVerification(context.from.id, {
        action: 'toggle_specialization',
        code: callback.slice('verify:spec:'.length),
      });
      await showVerificationStep(context, language, verification);
      return;
    }
    if (callback === 'verify:spec-done') {
      const verification = await context.yuristimApi.updateVerification(context.from.id, {
        action: 'finish_specializations',
      });
      await showVerificationStep(context, language, verification);
      return;
    }
    if (callback === 'verify:price-skip') {
      const verification = await context.yuristimApi.updateVerification(context.from.id, {
        action: 'set_price',
        consultationPrice: null,
      });
      await showVerificationStep(context, language, verification);
      return;
    }
    if (callback === 'verify:submit') {
      const verification = await context.yuristimApi.updateVerification(context.from.id, {
        action: 'submit',
      });
      await editOrReply(context, t(language, 'verificationSubmitted'));
      if (context.botConfig.adminTelegramId && verification) {
        await context.api
          .sendMessage(
            context.botConfig.adminTelegramId,
            `New lawyer verification: ${verification.id}`,
          )
          .catch(() => undefined);
      }
      return;
    }
    if (callback === 'lawyer:mode' || callback === 'user:mode') {
      await context.yuristimApi.switchMode(
        context.from.id,
        callback === 'lawyer:mode' ? 'lawyer' : 'user',
      );
      data = await context.yuristimApi.getTelegramUserContext(context.from.id);
      await editOrReply(
        context,
        t(language, callback === 'lawyer:mode' ? 'verificationModeEnabled' : 'roleChanged'),
      );
      await showMainMenu(context, data);
      return;
    }

    if (callback.startsWith('service:')) {
      const message =
        callback === 'service:create-document'
          ? t(language, 'documentLater')
          : t(language, 'featureLater');
      const shell = shellBack(language, message, 'nav:services');
      await editOrReply(context, shell.text, shell.options);
      return;
    }

    if (callback === 'settings:profile') {
      const shell = shellBack(language, profileText(data), 'nav:settings');
      await editOrReply(context, shell.text, shell.options);
      return;
    }
    if (callback === 'settings:role') {
      await editOrReply(context, t(language, 'chooseRole'), {
        reply_markup: roleKeyboard(language),
      });
      return;
    }
    if (callback === 'settings:language') {
      await editOrReply(context, t(language, 'chooseLanguage'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }
    if (callback === 'settings:pin') {
      const shell = shellBack(
        language,
        t(language, data.hasPin ? 'pinEnabled' : 'pinDisabled'),
        'nav:settings',
      );
      await editOrReply(context, shell.text, shell.options);
      return;
    }
    if (callback === 'settings:about') {
      const shell = shellBack(language, aboutText(language, context.botConfig), 'nav:settings');
      await editOrReply(context, shell.text, shell.options);
      return;
    }
    if (callback === 'settings:logout') {
      const shell = shellBack(language, t(language, 'logoutInfo'), 'nav:settings');
      await editOrReply(context, shell.text, shell.options);
      return;
    }
    if (callback === 'settings:lawyer-profile') {
      await showLawyerProfile(context, language);
      return;
    }
    if (callback.startsWith('settings:')) {
      const text = t(language, 'featureLater');
      const shell = shellBack(language, text, 'nav:settings');
      await editOrReply(context, shell.text, shell.options);
      return;
    }

    if (callback.startsWith('questions:')) {
      const text =
        callback === 'questions:support' && context.botConfig.supportUsername
          ? `@${context.botConfig.supportUsername}`
          : callback === 'questions:support'
            ? t(language, 'supportUnavailable')
            : t(language, 'featureLater');
      const shell = shellBack(language, text, 'nav:questions');
      await editOrReply(context, shell.text, shell.options);
    }
  });
}
