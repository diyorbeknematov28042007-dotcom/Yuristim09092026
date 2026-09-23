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
import { elapsedBotMilliseconds, recordBotPerformance } from '../observability/performance.js';

export function registerMessageHandler(composer: Composer<YuristimBotContext>): void {
  composer.on('message:text', async (context) => {
    if (!context.from) return;
    const runtime = await context.yuristimApi.getRuntimeContext(context.from.id);
    recordBotPerformance('bot_context_ready', {
      durationMilliseconds: elapsedBotMilliseconds(),
    });
    const language = runtime.user.language ?? 'uz';
    const message = context.message.text;

    if (runtime.user.onboardingStatus === 'name_required') {
      const fullName = validFullName(message);
      if (!fullName) {
        await context.reply(t(language, 'nameInvalid'));
        return;
      }
      const data = await context.yuristimApi.updateOnboarding(context.from.id, {
        action: 'set_full_name',
        fullName,
      });
      if (data.user.onboardingStatus === 'completed' && data.user.onboardingRole === 'lawyer') {
        await context.reply(t(language, 'lawyerInfo'));
      }
      await showOnboardingStep(context, data, context.botConfig);
      return;
    }
    if (runtime.user.onboardingStatus !== 'completed') {
      await showOnboardingStep(context, runtime, context.botConfig);
      return;
    }

    if (runtime.lawyer.verificationStatus === 'draft') {
      const step = runtime.lawyer.draftStep ?? 'full_name';
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
        const lawyer = await context.yuristimApi.getLawyerContext(context.from.id);
        await showVerificationStep(context, language, lawyer.verification);
        return;
      }
      const verification = await context.yuristimApi.updateVerification(context.from.id, action);
      await showVerificationStep(context, language, verification);
      return;
    }

    const marketplaceDraftStep = runtime.marketplace.draftStep;
    if (marketplaceDraftStep) {
      if (marketplaceDraftStep === 'description') {
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
      if (marketplaceDraftStep === 'region') {
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
      if (marketplaceDraftStep === 'additional_details') {
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
      await showMarketplaceDraft(
        context,
        language,
        await context.yuristimApi.getMarketplaceDraft(context.from.id),
      );
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
    if (message === t(language, 'findLawyer') && runtime.user.activeMode === 'user') {
      await context.yuristimApi.leaveAi(context.from.id);
      await showMarketplaceUserHome(context, language);
      return;
    }
    if (message === t(language, 'findClients') && runtime.user.activeMode === 'lawyer') {
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

    if (runtime.ai.botChatActive && runtime.ai.activeConversationId) {
      await sendAiPrompt(
        context,
        language,
        runtime.ai.activeConversationId,
        message,
        `telegram:${context.chat.id}:${context.message.message_id}`,
        runtime.ai,
      );
      return;
    }

    await context.reply(t(language, 'unknownMessage'));
    await showMainMenu(context, runtime);
  });

  composer.on('message:photo', async (context) => {
    if (!context.from) return;
    const runtime = await context.yuristimApi.getRuntimeContext(context.from.id);
    recordBotPerformance('bot_context_ready', {
      durationMilliseconds: elapsedBotMilliseconds(),
    });
    const language = runtime.user.language ?? 'uz';
    const step = runtime.lawyer.verificationStatus === 'draft' ? runtime.lawyer.draftStep : null;
    if (step !== 'profile_image' && step !== 'verification_document') {
      if (runtime.ai.botChatActive) await showAiFileRedirect(context, language, runtime.ai);
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
    const runtime = await context.yuristimApi.getRuntimeContext(context.from.id);
    recordBotPerformance('bot_context_ready', {
      durationMilliseconds: elapsedBotMilliseconds(),
    });
    const language = runtime.user.language ?? 'uz';
    const step = runtime.lawyer.verificationStatus === 'draft' ? runtime.lawyer.draftStep : null;
    if (step !== 'profile_image' && step !== 'verification_document') {
      if (runtime.ai.botChatActive) await showAiFileRedirect(context, language, runtime.ai);
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
    const runtime = await context.yuristimApi.getRuntimeContext(context.from.id);
    recordBotPerformance('bot_context_ready', {
      durationMilliseconds: elapsedBotMilliseconds(),
    });
    if (runtime.ai.botChatActive)
      await showAiFileRedirect(context, runtime.user.language ?? 'uz', runtime.ai);
  });

  composer.on('message:audio', async (context) => {
    if (!context.from) return;
    const runtime = await context.yuristimApi.getRuntimeContext(context.from.id);
    recordBotPerformance('bot_context_ready', {
      durationMilliseconds: elapsedBotMilliseconds(),
    });
    if (runtime.ai.botChatActive)
      await showAiFileRedirect(context, runtime.user.language ?? 'uz', runtime.ai);
  });
}
