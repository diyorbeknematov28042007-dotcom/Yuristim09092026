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
import {
  showAcceptBalance,
  showBalance,
  showCreditHistory,
  showCreditProducts,
} from '../services/credit.service.js';
import { balanceBackKeyboard } from '../keyboards/balance.keyboard.js';
import { YuristimApiError } from '../api/yuristim-api.client.js';
import {
  confirmMarketplaceDraft,
  editMarketplaceChannelStatus,
  findMarketplacePost,
  showLawyerMarketplace,
  showMarketplaceAcceptances,
  showMarketplaceDraft,
  showMarketplaceRequest,
  showMarketplaceRequests,
  showMarketplaceReview,
  showMarketplaceUserHome,
} from '../services/marketplace.service.js';
import {
  leaveAiChat,
  showAiConversation,
  showAiHistory,
  showAiHome,
  startNewAiConversation,
  switchAiMode,
} from '../services/ai.service.js';
import { elapsedBotMilliseconds, recordBotPerformance } from '../observability/performance.js';

export function registerCallbackHandler(composer: Composer<YuristimBotContext>): void {
  composer.on('callback_query:data', async (context) => {
    const callback = parseCallbackData(context.callbackQuery.data);
    if (!callback || !context.from) {
      let acknowledged = false;
      try {
        await context.answerCallbackQuery({
          show_alert: true,
          text: t(telegramLanguage(context.from?.language_code), 'invalidAction'),
        });
        acknowledged = true;
      } finally {
        recordBotPerformance('callback_ack', {
          durationMilliseconds: elapsedBotMilliseconds(),
          success: acknowledged,
        });
      }
      return;
    }
    let acknowledged = false;
    try {
      await context.answerCallbackQuery();
      acknowledged = true;
    } finally {
      recordBotPerformance('callback_ack', {
        durationMilliseconds: elapsedBotMilliseconds(),
        success: acknowledged,
      });
    }
    let data = await context.yuristimApi.getTelegramUserContext(context.from.id);
    recordBotPerformance('bot_context_ready', {
      durationMilliseconds: elapsedBotMilliseconds(),
    });
    let language = data.user.language ?? telegramLanguage(context.from.language_code);
    const controllerCallbacks = new Set([
      'ai:back',
      'ai:new',
      'ai:history',
      'ai:mode:fast',
      'ai:mode:expert',
    ]);
    if (controllerCallbacks.has(callback)) {
      const callbackMessageId = context.callbackQuery.message?.message_id;
      const status = await context.yuristimApi.getAiStatus(context.from.id);
      if (!callbackMessageId || status.telegramControlMessageId !== callbackMessageId) {
        await context.reply(t(language, 'aiControllerExpired'));
        return;
      }
    }

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
      await showAiHome(context, language);
      return;
    }
    if (callback === 'ai:back') {
      await leaveAiChat(context);
      await showMainMenu(context, data);
      return;
    }
    if (callback === 'ai:new') {
      await startNewAiConversation(context, language);
      return;
    }
    if (callback === 'ai:history') {
      await showAiHistory(context, language);
      return;
    }
    if (callback === 'ai:mode:fast' || callback === 'ai:mode:expert') {
      await switchAiMode(context, language, callback.endsWith('expert') ? 'expert' : 'fast');
      return;
    }
    if (callback.startsWith('ai:open:')) {
      await showAiConversation(context, language, callback.slice('ai:open:'.length));
      return;
    }
    if (callback === 'nav:balance') {
      await showBalance(context, language);
      return;
    }
    if (callback === 'mp:new') {
      const draft = await context.yuristimApi.updateMarketplaceDraft(context.from.id, {
        action: 'start',
      });
      await showMarketplaceDraft(context, language, draft);
      return;
    }
    if (callback === 'mp:mine') {
      await showMarketplaceRequests(context, language);
      return;
    }
    if (callback.startsWith('mp:spec:')) {
      const draft = await context.yuristimApi.updateMarketplaceDraft(context.from.id, {
        action: 'set_specialization',
        specializationCode: callback.slice('mp:spec:'.length),
      });
      await showMarketplaceDraft(context, language, draft);
      return;
    }
    if (callback === 'mp:back') {
      await showMarketplaceDraft(
        context,
        language,
        await context.yuristimApi.updateMarketplaceDraft(context.from.id, { action: 'back' }),
      );
      return;
    }
    if (callback === 'mp:skip-region') {
      await showMarketplaceDraft(
        context,
        language,
        await context.yuristimApi.updateMarketplaceDraft(context.from.id, {
          action: 'set_region',
          region: null,
        }),
      );
      return;
    }
    if (callback === 'mp:skip-details') {
      await showMarketplaceDraft(
        context,
        language,
        await context.yuristimApi.updateMarketplaceDraft(context.from.id, {
          action: 'set_additional_details',
          additionalDetails: null,
        }),
      );
      return;
    }
    if (callback === 'mp:cancel-draft') {
      await context.yuristimApi.updateMarketplaceDraft(context.from.id, { action: 'cancel' });
      await showMarketplaceUserHome(context, language);
      return;
    }
    if (callback === 'mp:confirm') {
      await confirmMarketplaceDraft(context, language);
      return;
    }
    if (callback.startsWith('mp:view:')) {
      await showMarketplaceRequest(context, language, callback.slice('mp:view:'.length));
      return;
    }
    if (callback.startsWith('mp:accepted:')) {
      await showMarketplaceAcceptances(context, language, callback.slice('mp:accepted:'.length));
      return;
    }
    if (callback.startsWith('mp:accept:')) {
      const publicIdentifier = callback.slice('mp:accept:'.length);
      const result = await context.yuristimApi.acceptMarketplaceListing(
        context.from.id,
        publicIdentifier,
      );
      await editOrReply(context, t(language, 'marketplaceAccepted'));
      if (!result.duplicate && result.ownerTelegramId) {
        await context.api
          .sendMessage(result.ownerTelegramId, t(language, 'marketplaceLawyerAcceptedNotice'))
          .catch(() => undefined);
      }
      const updated = await context.yuristimApi
        .getMarketplaceListing(publicIdentifier, language)
        .catch(() => null);
      if (updated && updated.acceptanceCount >= updated.maxAcceptances) {
        await editMarketplaceChannelStatus(context, updated, '🔒 Qabul limiti to‘ldi');
      }
      return;
    }
    if (callback.startsWith('mp:select:')) {
      const [, , publicIdentifier, acceptanceId] = callback.split(':');
      if (!publicIdentifier || !acceptanceId) return;
      const post = await findMarketplacePost(context, publicIdentifier);
      if (!post) return;
      const result = await context.yuristimApi.selectMarketplaceLawyer(
        context.from.id,
        post.id,
        acceptanceId,
      );
      if (!result.duplicate) {
        for (const telegramId of result.acceptedLawyerTelegramIds) {
          const message =
            telegramId === result.selectedLawyerTelegramId
              ? t(language, 'marketplaceChosenNotice')
              : t(language, 'marketplaceClosedNotice');
          await context.api.sendMessage(telegramId, message).catch(() => undefined);
        }
      }
      const updated = await findMarketplacePost(context, publicIdentifier);
      if (updated) await editMarketplaceChannelStatus(context, updated, '✅ Yurist tanlandi');
      await editOrReply(context, t(language, 'marketplaceSelected'));
      return;
    }
    if (callback.startsWith('mp:cancel:')) {
      const publicIdentifier = callback.slice('mp:cancel:'.length);
      const post = await findMarketplacePost(context, publicIdentifier);
      if (!post) return;
      const result = await context.yuristimApi.cancelMarketplaceRequest(context.from.id, post.id);
      for (const telegramId of result.participantTelegramIds)
        await context.api
          .sendMessage(telegramId, t(language, 'marketplaceClosedNotice'))
          .catch(() => undefined);
      await editMarketplaceChannelStatus(context, result.post, '❌ Murojaat yopildi');
      await editOrReply(context, t(language, 'marketplaceCancelled'));
      return;
    }
    if (callback.startsWith('mp:review:')) {
      await showMarketplaceReview(context, language, callback.slice('mp:review:'.length));
      return;
    }
    if (callback.startsWith('mp:rate:')) {
      const [, , publicIdentifier, ratingText] = callback.split(':');
      if (!publicIdentifier || !ratingText) return;
      const post = await findMarketplacePost(context, publicIdentifier);
      if (!post) return;
      await context.yuristimApi.reviewMarketplaceLawyer(
        context.from.id,
        post.id,
        Number(ratingText),
      );
      await editOrReply(context, t(language, 'marketplaceReviewSaved'));
      return;
    }
    if (callback === 'mp:dashboard') {
      await showLawyerMarketplace(context, language);
      return;
    }
    if (callback === 'credits:buy') {
      await showCreditProducts(context, language);
      return;
    }
    if (callback === 'credits:history') {
      await showCreditHistory(context, language);
      return;
    }
    if (callback === 'credits:accepts') {
      try {
        await showAcceptBalance(context, language);
      } catch (error) {
        if (!(error instanceof YuristimApiError) || error.code !== 'LAWYER_NOT_VERIFIED')
          throw error;
        await editOrReply(context, t(language, 'acceptsLawyerOnly'), {
          reply_markup: balanceBackKeyboard(language),
        });
      }
      return;
    }
    if (callback === 'credits:all-plans') {
      await editOrReply(context, t(language, 'plansUnavailable'), {
        reply_markup: balanceBackKeyboard(language),
      });
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

    if (callback === 'questions:ai') {
      await showAiHome(context, language);
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
