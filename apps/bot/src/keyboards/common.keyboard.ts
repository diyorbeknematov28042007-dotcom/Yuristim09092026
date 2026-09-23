import type { Language } from '@yuristim/types';
import { InlineKeyboard } from 'grammy';
import { t } from '../i18n/index.js';
import type { CallbackData } from '../types/callback.js';

export function languageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🇺🇿 O‘zbekcha', 'lang:uz')
    .row()
    .text('🇷🇺 Русский', 'lang:ru')
    .row()
    .text('🇬🇧 English', 'lang:en');
}

export function roleKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'roleUser'), 'role:user')
    .row()
    .text(t(language, 'roleLawyer'), 'role:lawyer');
}

export function termsKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard().text(t(language, 'acceptTerms'), 'terms:accept');
}

export function resumeKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'continue'), 'onboarding:continue')
    .row()
    .text(t(language, 'reset'), 'onboarding:reset');
}

export function backKeyboard(language: Language, callback: CallbackData): InlineKeyboard {
  return new InlineKeyboard().text(t(language, 'back'), callback);
}
