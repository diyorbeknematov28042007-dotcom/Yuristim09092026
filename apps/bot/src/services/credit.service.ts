import type {
  CreditBalanceView,
  CreditProductView,
  CreditTransactionPage,
  CreditTransactionType,
  Language,
  MarketplaceAcceptBalanceView,
  MarketplaceAcceptProductView,
} from '@yuristim/types';
import type { YuristimBotContext } from '../bot.js';
import { t, type MessageKey } from '../i18n/index.js';
import { balanceBackKeyboard, balanceKeyboard } from '../keyboards/balance.keyboard.js';
import { editOrReply } from './navigation.service.js';

const transactionKeys: Record<CreditTransactionType, MessageKey> = {
  adjustment: 'creditTypeAdjustment',
  admin_bonus: 'creditTypeAdminBonus',
  ai_usage: 'creditTypeAiUsage',
  document_usage: 'creditTypeDocumentUsage',
  purchase: 'creditTypePurchase',
  refund: 'creditTypeRefund',
  reversal: 'creditTypeReversal',
  student_bonus: 'creditTypeStudentBonus',
  weekly_bonus: 'creditTypeWeeklyBonus',
  welcome_bonus: 'creditTypeWelcomeBonus',
};

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '');
}

function money(value: number, language: Language): string {
  const locale = language === 'ru' ? 'ru-RU' : language === 'en' ? 'en-US' : 'uz-UZ';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} UZS`;
}

export function balanceText(language: Language, balance: CreditBalanceView): string {
  const lines = [
    t(language, 'balanceTitle'),
    '',
    `${t(language, 'totalBalance')}: ${number(balance.total)}`,
    `${t(language, 'bonusCredit')}: ${number(balance.bonus)}`,
    `${t(language, 'weeklyCredit')}: ${number(balance.weekly)}`,
    `${t(language, 'paidCredit')}: ${number(balance.paid)}`,
  ];
  if (balance.nextExpiry)
    lines.push(`${t(language, 'nextExpiry')}: ${balance.nextExpiry.slice(0, 10)}`);
  return lines.join('\n');
}

export async function showBalance(context: YuristimBotContext, language: Language): Promise<void> {
  const balance = await context.yuristimApi.getCreditBalance(context.from!.id);
  await editOrReply(context, balanceText(language, balance), {
    reply_markup: balanceKeyboard(language),
  });
}

export function productsText(language: Language, products: CreditProductView[]): string {
  if (products.length === 0)
    return `${t(language, 'creditProductsTitle')}\n\n${t(language, 'noActiveCreditProducts')}`;
  return [
    t(language, 'creditProductsTitle'),
    '',
    ...products.map(
      (product) =>
        `• ${product.name}: ${number(product.creditAmount)} — ${money(product.price, language)}`,
    ),
  ].join('\n');
}

export function historyText(language: Language, history: CreditTransactionPage): string {
  if (history.items.length === 0)
    return `${t(language, 'creditHistoryTitle')}\n\n${t(language, 'noCreditHistory')}`;
  return [
    t(language, 'creditHistoryTitle'),
    '',
    ...history.items.map((item) => {
      const sign = item.amount > 0 ? '+' : '';
      return [
        `${t(language, transactionKeys[item.type])}: ${sign}${number(item.amount)}`,
        `${item.createdAt.slice(0, 10)} · ${t(language, 'remainingBalance')}: ${number(item.balanceAfter)}`,
      ].join('\n');
    }),
  ].join('\n\n');
}

export function acceptText(
  language: Language,
  balance: MarketplaceAcceptBalanceView,
  products: MarketplaceAcceptProductView[],
): string {
  const lines = [
    t(language, 'acceptBalanceTitle'),
    '',
    `${t(language, 'acceptUnits')}: ${balance.balance}`,
  ];
  if (balance.nextExpiry)
    lines.push(`${t(language, 'nextExpiry')}: ${balance.nextExpiry.slice(0, 10)}`);
  if (products.length > 0) {
    lines.push(
      '',
      t(language, 'acceptProductsTitle'),
      ...products.map(
        (product) =>
          `• ${product.name}: ${product.acceptCount} — ${money(product.price, language)}`,
      ),
    );
  }
  return lines.join('\n');
}

export async function showCreditProducts(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  const products = await context.yuristimApi.getCreditProducts(context.from!.id);
  await editOrReply(context, productsText(language, products), {
    reply_markup: balanceBackKeyboard(language),
  });
}

export async function showCreditHistory(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  const history = await context.yuristimApi.getCreditHistory(context.from!.id);
  await editOrReply(context, historyText(language, history), {
    reply_markup: balanceBackKeyboard(language),
  });
}

export async function showAcceptBalance(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  const [balance, products] = await Promise.all([
    context.yuristimApi.getAcceptBalance(context.from!.id),
    context.yuristimApi.getAcceptProducts(context.from!.id),
  ]);
  await editOrReply(context, acceptText(language, balance, products), {
    reply_markup: balanceBackKeyboard(language),
  });
}
