import type { Language } from '@yuristim/types';
import { en } from './en.js';
import { ru } from './ru.js';
import { uz } from './uz.js';

export type MessageKey = keyof typeof uz;
export const dictionaries = { en, ru, uz } as const;

export function t(language: Language | null | undefined, key: MessageKey): string {
  return dictionaries[language ?? 'uz'][key] ?? uz[key];
}

export function telegramLanguage(languageCode?: string): Language {
  if (languageCode?.startsWith('ru')) return 'ru';
  if (languageCode?.startsWith('en')) return 'en';
  return 'uz';
}
