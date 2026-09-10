import type { BotLawyerContext, Language, LawyerVerificationDraft } from '@yuristim/types';
import { InlineKeyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function lawyerProfileKeyboard(
  language: Language,
  context: BotLawyerContext,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (!context.verification || context.verification.status === 'rejected') {
    keyboard
      .text(
        t(language, context.verification ? 'verificationResubmit' : 'verificationStart'),
        'verify:start',
      )
      .row();
  } else if (context.profile?.verificationStatus === 'approved') {
    keyboard
      .text(t(language, 'verificationEdit'), 'verify:edit')
      .row()
      .text(t(language, 'switchLawyerMode'), 'lawyer:mode')
      .row();
  }
  return keyboard.text(t(language, 'back'), 'nav:settings');
}

export function verificationNavigation(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'back'), 'verify:back')
    .text(t(language, 'cancel'), 'verify:cancel');
}

export function specializationsKeyboard(
  language: Language,
  context: BotLawyerContext,
  draft: LawyerVerificationDraft,
): InlineKeyboard {
  const selected = new Set(draft.specializationCodes ?? []);
  const keyboard = new InlineKeyboard();
  for (const item of context.specializations) {
    keyboard
      .text(`${selected.has(item.code) ? '☑' : '☐'} ${item.name}`, `verify:spec:${item.code}`)
      .row();
  }
  keyboard.text(t(language, 'done'), 'verify:spec-done').row();
  return keyboard
    .text(t(language, 'back'), 'verify:back')
    .text(t(language, 'cancel'), 'verify:cancel');
}

export function priceKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'skip'), 'verify:price-skip')
    .row()
    .text(t(language, 'back'), 'verify:back')
    .text(t(language, 'cancel'), 'verify:cancel');
}

export function submitKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'verificationSubmit'), 'verify:submit')
    .row()
    .text(t(language, 'back'), 'verify:back')
    .text(t(language, 'cancel'), 'verify:cancel');
}
