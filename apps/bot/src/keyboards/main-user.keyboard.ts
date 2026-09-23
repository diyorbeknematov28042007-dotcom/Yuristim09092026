import type { Language } from '@yuristim/types';
import { Keyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function mainUserKeyboard(language: Language): Keyboard {
  return new Keyboard()
    .text(t(language, 'ai'))
    .row()
    .text(t(language, 'findLawyer'))
    .text(t(language, 'services'))
    .row()
    .text(t(language, 'balance'))
    .row()
    .text(t(language, 'settings'))
    .text(t(language, 'questions'))
    .resized()
    .persistent();
}
