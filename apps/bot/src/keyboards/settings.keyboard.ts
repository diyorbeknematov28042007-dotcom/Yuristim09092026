import type { Language } from '@yuristim/types';
import { InlineKeyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function settingsKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'profile'), 'settings:profile')
    .row()
    .text(t(language, 'switchRole'), 'settings:role')
    .text(t(language, 'language'), 'settings:language')
    .row()
    .text(t(language, 'securityPin'), 'settings:pin')
    .row()
    .text(t(language, 'myDocuments'), 'settings:documents')
    .text(t(language, 'notifications'), 'settings:notifications')
    .row()
    .text(t(language, 'lawyerProfile'), 'settings:lawyer-profile')
    .row()
    .text(t(language, 'about'), 'settings:about')
    .text(t(language, 'logout'), 'settings:logout')
    .row()
    .text(t(language, 'back'), 'nav:main');
}
