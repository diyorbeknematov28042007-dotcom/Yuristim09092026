import type { Language } from '@yuristim/types';
import { InlineKeyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function balanceKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'buyCredits'), 'credits:buy')
    .row()
    .text(t(language, 'creditHistory'), 'credits:history')
    .row()
    .text(t(language, 'acceptUnits'), 'credits:accepts')
    .row()
    .text(t(language, 'allPlans'), 'credits:all-plans')
    .row()
    .text(t(language, 'back'), 'nav:main');
}

export function balanceBackKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard().text(t(language, 'back'), 'nav:balance');
}
