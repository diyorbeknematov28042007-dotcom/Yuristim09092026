import type { Composer } from 'grammy';
import type { YuristimBotContext } from '../bot.js';
import { t } from '../i18n/index.js';
import { questionsKeyboard } from '../keyboards/questions.keyboard.js';
import { servicesKeyboard } from '../keyboards/services.keyboard.js';
import { settingsKeyboard } from '../keyboards/settings.keyboard.js';
import { showMainMenu, showOnboardingStep } from '../services/navigation.service.js';
import { showVerificationStep } from '../services/lawyer-verification.service.js';
import { validFullName } from '../services/user-context.service.js';
import { showBalance } from '../services/credit.service.js';
import {
  showLawyerDiscovery,
  showLawyerMarketplace,
  showMarketplaceDraft,
  showMarketplaceUserHome,
} from '../services/marketplace.service.js';
import { sendAiPrompt, showAiFileRedirect, showAiHome } from '../services/ai.service.js';

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

    const lawyer = await context.yuristimApi.getLawyerContext(context.from.id);
    if (lawyer.verification?.status === 'draft') {
      const step = lawyer.verification.draft.step ?? 'full_name';
      let action:
        | { action: 'set_full_name'; fullName: string }
        | { action: 'set_region'; region: string }
        | { action: 'set_experience'; experienceYears: number }
        | { action: 'set_bio'; bio: string }
        | { action: 'set_price'; consultationPrice: number };
      if (step === 'full_name') {
        const fullName = validFullName(message);
        if (!fullName) {
          await context.reply(t(language, 'verificationInvalidInput'));
          return;
        }
        action = { action: 'set_full_name', fullName };
      } else if (step === 'region') {
        const region = message.trim();
        if (region.length < 2 || region.length > 120) {
          await context.reply(t(language, 'verificationInvalidInput'));
          return;
        }
        action = { action: 'set_region', region };
      } else if (step === 'experience') {
        const experienceYears = Number(message.trim());
        if (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 70) {
          await context.reply(t(language, 'verificationInvalidInput'));
          return;
        }
        action = { action: 'set_experience', experienceYears };
      } else if (step === 'bio') {
        const bio = message.trim();
        if (bio.length < 20 || bio.length > 1000) {
          await context.reply(t(language, 'verificationInvalidInput'));
          return;
        }
        action = { action: 'set_bio', bio };
      } else if (step === 'price') {
        const consultationPrice = Number(message.replaceAll(' ', '').trim());
        if (
          !Number.isFinite(consultationPrice) ||
          consultationPrice < 0 ||
          consultationPrice > 1_000_000_000
        ) {
          await context.reply(t(language, 'verificationInvalidInput'));
          return;
        }
        action = { action: 'set_price', consultationPrice };
      } else {
        await showVerificationStep(context, language, lawyer.verification);
        return;
      }
      const verification = await context.yuristimApi.updateVerification(context.from.id, action);
      await showVerificationStep(context, language, verification);
      return;
    }

    const marketplaceDraft =
      typeof context.yuristimApi.getMarketplaceDraft === 'function'
        ? await context.yuristimApi.getMarketplaceDraft(context.from.id)
        : null;
    if (marketplaceDraft) {
      if (marketplaceDraft.step === 'description') {
        if (message.trim().length < 20 || message.trim().length > 1500) {
          await context.reply(t(language, 'verificationInvalidInput'));
          return;
        }
        await showMarketplaceDraft(
          context,
          language,
          await context.yuristimApi.updateMarketplaceDraft(context.from.id, {
            action: 'set_description',
            description: message.trim(),
          }),
        );
        return;
      }
      if (marketplaceDraft.step === 'region') {
        if (message.trim().length < 2 || message.trim().length > 120) {
          await context.reply(t(language, 'verificationInvalidInput'));
          return;
        }
        await showMarketplaceDraft(
          context,
          language,
          await context.yuristimApi.updateMarketplaceDraft(context.from.id, {
            action: 'set_region',
            region: message.trim(),
          }),
        );
        return;
      }
      if (marketplaceDraft.step === 'additional_details') {
        if (message.trim().length < 2 || message.trim().length > 1500) {
          await context.reply(t(language, 'verificationInvalidInput'));
          return;
        }
        await showMarketplaceDraft(
          context,
          language,
          await context.yuristimApi.updateMarketplaceDraft(context.from.id, {
            action: 'set_additional_details',
            additionalDetails: message.trim(),
          }),
        );
        return;
      }
      await showMarketplaceDraft(context, language, marketplaceDraft);
      return;
    }

    if (message === t(language, 'ai')) {
      await showAiHome(context, language);
      return;
    }
    if (message === t(language, 'services')) {
      await context.yuristimApi.leaveAi(context.from.id);
      await context.reply(t(language, 'servicesTitle'), {
        reply_markup: servicesKeyboard(language),
      });
      return;
    }
    if (message === t(language, 'findLawyer') && data.user.activeMode === 'user') {
      await context.yuristimApi.leaveAi(context.from.id);
      await showMarketplaceUserHome(context, language);
      return;
    }
    if (message === t(language, 'findClients') && data.user.activeMode === 'lawyer') {
      await context.yuristimApi.leaveAi(context.from.id);
      await showLawyerDiscovery(context, language);
      return;
    }
    if (message === t(language, 'settings')) {
      await context.yuristimApi.leaveAi(context.from.id);
      await context.reply(t(language, 'settingsTitle'), {
        reply_markup: settingsKeyboard(language),
      });
      return;
    }
    if (message === t(language, 'questions')) {
      await context.yuristimApi.leaveAi(context.from.id);
      await context.reply(t(language, 'questionsTitle'), {
        reply_markup: questionsKeyboard(language),
      });
      return;
    }
    if (message === t(language, 'balance')) {
      await context.yuristimApi.leaveAi(context.from.id);
      await showBalance(context, language);
      return;
    }
    if (message === t(language, 'marketplace')) {
      await context.yuristimApi.leaveAi(context.from.id);
      await showLawyerMarketplace(context, language);
      return;
    }

    const aiStatus = await context.yuristimApi.getAiStatus(context.from.id);
    if (aiStatus.botChatActive && aiStatus.activeConversationId) {
      await sendAiPrompt(
        context,
        language,
        aiStatus.activeConversationId,
        message,
        `telegram:${context.chat.id}:${context.message.message_id}`,
      );
      return;
    }

    await context.reply(t(language, 'unknownMessage'));
    await showMainMenu(context, data);
  });

  composer.on('message:photo', async (context) => {
    if (!context.from) return;
    const data = await context.yuristimApi.getTelegramUserContext(context.from.id);
    const language = data.user.language ?? 'uz';
    const lawyer = await context.yuristimApi.getLawyerContext(context.from.id);
    const step = lawyer.verification?.status === 'draft' ? lawyer.verification.draft.step : null;
    if (step !== 'profile_image' && step !== 'verification_document') {
      const aiStatus = await context.yuristimApi.getAiStatus(context.from.id);
      if (aiStatus.botChatActive) await showAiFileRedirect(context, language);
      return;
    }
    const photo = context.message.photo.at(-1);
    if (!photo || (photo.file_size !== undefined && photo.file_size > 5 * 1024 * 1024)) {
      await context.reply(t(language, 'verificationFileInvalid'));
      return;
    }
    try {
      const file = await context.downloadTelegramFile(
        photo.file_id,
        'image/jpeg',
        `${photo.file_unique_id}.jpg`,
      );
      await context.yuristimApi.uploadVerificationFile(context.from.id, {
        ...file,
        kind: step === 'profile_image' ? 'profile_image' : 'verification_document',
      });
      await showVerificationStep(context, language);
    } catch {
      await context.reply(t(language, 'verificationFileInvalid'));
    }
  });

  composer.on('message:document', async (context) => {
    if (!context.from) return;
    const data = await context.yuristimApi.getTelegramUserContext(context.from.id);
    const language = data.user.language ?? 'uz';
    const lawyer = await context.yuristimApi.getLawyerContext(context.from.id);
    const step = lawyer.verification?.status === 'draft' ? lawyer.verification.draft.step : null;
    if (step !== 'profile_image' && step !== 'verification_document') {
      const aiStatus = await context.yuristimApi.getAiStatus(context.from.id);
      if (aiStatus.botChatActive) await showAiFileRedirect(context, language);
      return;
    }
    const document = context.message.document;
    const contentType = document.mime_type;
    if (
      !contentType ||
      !['application/pdf', 'image/jpeg', 'image/png'].includes(contentType) ||
      (step === 'profile_image' && contentType === 'application/pdf') ||
      (document.file_size !== undefined && document.file_size > 5 * 1024 * 1024)
    ) {
      await context.reply(t(language, 'verificationFileInvalid'));
      return;
    }
    try {
      const file = await context.downloadTelegramFile(
        document.file_id,
        contentType,
        document.file_name ?? document.file_unique_id,
      );
      await context.yuristimApi.uploadVerificationFile(context.from.id, {
        ...file,
        kind: step === 'profile_image' ? 'profile_image' : 'verification_document',
      });
      await showVerificationStep(context, language);
    } catch {
      await context.reply(t(language, 'verificationFileInvalid'));
    }
  });

  composer.on('message:voice', async (context) => {
    if (!context.from) return;
    const data = await context.yuristimApi.getTelegramUserContext(context.from.id);
    const status = await context.yuristimApi.getAiStatus(context.from.id);
    if (status.botChatActive) await showAiFileRedirect(context, data.user.language ?? 'uz');
  });

  composer.on('message:audio', async (context) => {
    if (!context.from) return;
    const data = await context.yuristimApi.getTelegramUserContext(context.from.id);
    const status = await context.yuristimApi.getAiStatus(context.from.id);
    if (status.botChatActive) await showAiFileRedirect(context, data.user.language ?? 'uz');
  });
}
