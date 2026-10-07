import type { Language } from '@yuristim/types';
import { InlineKeyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function servicesKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'documentSamples'), 'service:document-samples')
    .row()
    .text(t(language, 'legalLibrary'), 'service:legal-library')
    .row()
    .text(t(language, 'createDocument'), 'service:create-document')
    .row()
    .text(t(language, 'freeCalculators'), 'service:free-calculators')
    .row()
    .text(t(language, 'back'), 'nav:main');
}

export function freeCalculatorsKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .url(t(language, 'allServices'), 'https://xizmatlar.yuristim.pp.ua/')
    .row()
    .url(t(language, 'servicesTerms'), 'https://xizmatlar.yuristim.pp.ua/foydalanish-shartlari')
    .row()
    .text(t(language, 'back'), 'nav:services');
}
