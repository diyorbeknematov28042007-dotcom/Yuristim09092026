import type { Language } from '@yuristim/types';
import { InlineKeyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function questionsKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'aiAssistant'), 'questions:ai')
    .row()
    .text(t(language, 'contactSupport'), 'questions:support')
    .row()
    .text(t(language, 'suggestion'), 'questions:suggestion')
    .row()
    .text(t(language, 'complaint'), 'questions:complaint')
    .row()
    .text(t(language, 'faq'), 'questions:faq')
    .row()
    .text(t(language, 'back'), 'nav:main');
}
