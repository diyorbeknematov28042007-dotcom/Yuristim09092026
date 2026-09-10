import type { CreditTransactionType, Language } from '@yuristim/types';
import { describe, expect, it } from 'vitest';
import { dictionaries, t } from '../i18n/index.js';
import { balanceBackKeyboard, balanceKeyboard } from '../keyboards/balance.keyboard.js';
import { acceptText, balanceText, historyText, productsText } from './credit.service.js';

const languages = ['uz', 'ru', 'en'] as const satisfies readonly Language[];

describe('credit bot presentation', () => {
  it.each(languages)('renders the complete balance breakdown in %s', (language) => {
    const text = balanceText(language, {
      bonus: 50,
      lowBalance: false,
      nextExpiry: '2026-09-14T19:00:00.000Z',
      paid: 1.5,
      total: 63.5,
      weekly: 12,
      zeroBalance: false,
    });
    expect(text).toContain(`${t(language, 'totalBalance')}: 63.5`);
    expect(text).toContain(`${t(language, 'weeklyCredit')}: 12`);
    expect(text).toContain(`${t(language, 'nextExpiry')}: 2026-09-14`);
  });

  it.each(languages)(
    'renders products, safe history, accepts, and back navigation in %s',
    (language) => {
      expect(
        productsText(language, [
          {
            code: 'credits_100',
            creditAmount: 100,
            currency: 'UZS',
            id: 'product-id',
            name: '100 credits',
            price: 10_000,
          },
        ]),
      ).toContain('10');
      const history = historyText(language, {
        items: [
          {
            amount: -3.4,
            balanceAfter: 46.6,
            bucketType: 'bonus',
            createdAt: '2026-09-10T00:00:00.000Z',
            expiresAt: null,
            id: 'transaction-id',
            reason: 'private reason',
            type: 'ai_usage',
          },
        ],
        limit: 5,
        page: 1,
        total: 1,
      });
      expect(history).toContain(`${t(language, 'creditTypeAiUsage')}: -3.4`);
      expect(history).not.toContain('transaction-id');
      expect(history).not.toContain('private reason');
      expect(
        acceptText(language, { balance: 1, nextExpiry: null }, [
          {
            acceptCount: 1,
            code: 'single_accept',
            currency: 'UZS',
            expiresInDays: null,
            id: 'accept-id',
            name: '1 accept',
            price: 9900,
          },
        ]),
      ).toContain(`${t(language, 'acceptUnits')}: 1`);
      expect(JSON.stringify(balanceKeyboard(language))).toContain('credits:history');
      expect(JSON.stringify(balanceBackKeyboard(language))).toContain('nav:balance');
    },
  );

  it('keeps every credit transaction type translated in all languages', () => {
    const transactionTypes: CreditTransactionType[] = [
      'purchase',
      'welcome_bonus',
      'weekly_bonus',
      'student_bonus',
      'admin_bonus',
      'ai_usage',
      'document_usage',
      'refund',
      'adjustment',
      'reversal',
    ];
    const suffixes = [
      'Purchase',
      'WelcomeBonus',
      'WeeklyBonus',
      'StudentBonus',
      'AdminBonus',
      'AiUsage',
      'DocumentUsage',
      'Refund',
      'Adjustment',
      'Reversal',
    ];
    expect(transactionTypes).toHaveLength(suffixes.length);
    for (const language of languages) {
      for (const suffix of suffixes) {
        expect(dictionaries[language]).toHaveProperty(`creditType${suffix}`);
      }
    }
  });
});
