import type { Language } from '@yuristim/types';
import { InlineKeyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function servicesKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'findLawyer'), 'service:find-lawyer')
    .row()
    .text(t(language, 'documentSamples'), 'service:document-samples')
    .row()
    .text(t(language, 'legalLibrary'), 'service:legal-library')
    .row()
    .text(t(language, 'createDocument'), 'service:create-document')
    .row()
    .text(t(language, 'back'), 'nav:main');
}
