import { describe, expect, it } from 'vitest';
import { dictionaries, t } from './index.js';

describe('bot i18n', () => {
  it('keeps Uzbek, Russian and English translation keys in parity', () => {
    const keys = Object.keys(dictionaries.uz).sort();
    expect(Object.keys(dictionaries.ru).sort()).toEqual(keys);
    expect(Object.keys(dictionaries.en).sort()).toEqual(keys);
  });

  it('falls back to Uzbek', () => {
    expect(t(null, 'mainTitle')).toBe(dictionaries.uz.mainTitle);
  });
});
