import type {
  BotLawyerContext,
  Language,
  LawyerVerificationDraft,
  LawyerVerificationView,
} from '@yuristim/types';
import type { YuristimBotContext } from '../bot.js';
import { t } from '../i18n/index.js';
import {
  lawyerProfileKeyboard,
  priceKeyboard,
  specializationsKeyboard,
  submitKeyboard,
  verificationNavigation,
} from '../keyboards/lawyer-verification.keyboard.js';
import { editOrReply } from './navigation.service.js';

export async function showLawyerProfile(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  const lawyer = await context.yuristimApi.getLawyerContext(context.from!.id);
  const verification = lawyer.verification;
  let status = t(language, 'verificationUnverified');
  if (verification?.status === 'pending_review' || verification?.status === 'submitted')
    status = t(language, 'verificationPending');
  if (lawyer.profile?.verificationStatus === 'approved')
    status = t(language, 'verificationApproved');
  if (verification?.status === 'rejected')
    status = `${t(language, 'verificationRejected')}\n${t(language, 'rejectionReason')}: ${verification.rejectReason ?? '—'}`;
  await editOrReply(context, status, { reply_markup: lawyerProfileKeyboard(language, lawyer) });
}

export async function showVerificationStep(
  context: YuristimBotContext,
  language: Language,
  verification?: LawyerVerificationView | null,
): Promise<void> {
  const lawyer = await context.yuristimApi.getLawyerContext(context.from!.id);
  const current = verification ?? lawyer.verification;
  if (!current || current.status !== 'draft') {
    await showLawyerProfile(context, language);
    return;
  }
  const draft = current.draft;
  switch (draft.step ?? 'full_name') {
    case 'full_name':
      await editOrReply(context, t(language, 'verificationFullName'), {
        reply_markup: verificationNavigation(language),
      });
      break;
    case 'region':
      await editOrReply(context, t(language, 'verificationRegion'), {
        reply_markup: verificationNavigation(language),
      });
      break;
    case 'specializations':
      await editOrReply(context, t(language, 'verificationSpecializations'), {
        reply_markup: specializationsKeyboard(language, lawyer, draft),
      });
      break;
    case 'experience':
      await editOrReply(context, t(language, 'verificationExperience'), {
        reply_markup: verificationNavigation(language),
      });
      break;
    case 'bio':
      await editOrReply(context, t(language, 'verificationBio'), {
        reply_markup: verificationNavigation(language),
      });
      break;
    case 'price':
      await editOrReply(context, t(language, 'verificationPrice'), {
        reply_markup: priceKeyboard(language),
      });
      break;
    case 'profile_image':
      await editOrReply(context, t(language, 'verificationProfileImage'), {
        reply_markup: verificationNavigation(language),
      });
      break;
    case 'verification_document':
      await editOrReply(context, t(language, 'verificationDocument'), {
        reply_markup: verificationNavigation(language),
      });
      break;
    case 'summary':
      await editOrReply(context, summary(language, draft, lawyer), {
        reply_markup: submitKeyboard(language),
      });
      break;
  }
}

function summary(
  language: Language,
  draft: LawyerVerificationDraft,
  context: BotLawyerContext,
): string {
  const names = new Map(context.specializations.map((item) => [item.code, item.name]));
  return [
    t(language, 'verificationSummary'),
    '',
    draft.fullName ?? '—',
    draft.region ?? '—',
    (draft.specializationCodes ?? []).map((code) => names.get(code) ?? code).join(', '),
    `${draft.experienceYears ?? 0}`,
    draft.bio ?? '—',
    draft.consultationPrice === null || draft.consultationPrice === undefined
      ? '—'
      : `${draft.consultationPrice.toLocaleString('uz-UZ')} UZS`,
  ].join('\n');
}
