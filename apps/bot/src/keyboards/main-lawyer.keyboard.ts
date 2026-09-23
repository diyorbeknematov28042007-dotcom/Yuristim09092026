import type { Language } from '@yuristim/types';
import { Keyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function mainLawyerKeyboard(language: Language): Keyboard {
  return new Keyboard()
    .text(t(language, 'ai'))
    .row()
    .text(t(language, 'findClients'))
    .text(t(language, 'services'))
    .row()
    .text(t(language, 'marketplace'))
    .row()
    .text(t(language, 'balance'))
    .text(t(language, 'settings'))
    .resized()
    .persistent();
}
