import {
  InsufficientCreditsError,
  type CreditProductRow,
  type CreditTransactionRow,
  type FinanceRepository,
} from '@yuristim/db';
import type {
  CreditBalanceView,
  CreditBucketType,
  CreditProductView,
  CreditTransactionPage,
  CreditTransactionType,
  Language,
  MarketplaceAcceptBalanceView,
  MarketplaceAcceptProductView,
} from '@yuristim/types';
import { AppError } from '../../lib/errors.js';

const LOW_BALANCE_THRESHOLD = 5;

function localizedName(
  product: { name_uz: string; name_ru: string; name_en: string },
  language: Language,
): string {
  return product[`name_${language}`];
}

function transactionView(row: CreditTransactionRow) {
  return {
    amount: row.amount,
    balanceAfter: row.balance_after,
    bucketType: row.bucket_type as CreditBucketType,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    reason: row.reason,
    type: row.type as CreditTransactionType,
  };
}

function productView(row: CreditProductRow, language: Language): CreditProductView {
  if (row.credit_amount === null || row.price === null)
    throw new Error('Active credit product is incomplete');
  return {
    code: row.code,
    creditAmount: row.credit_amount,
    currency: 'UZS',
    id: row.id,
    name: localizedName(row, language),
    price: row.price,
  };
}

export class CreditService {
  constructor(
    readonly repository: FinanceRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getBalance(userId: string): Promise<CreditBalanceView> {
    const row = await this.repository.getCreditBalance(userId, this.now());
    return {
      bonus: row.bonus,
      lowBalance: row.total > 0 && row.total <= LOW_BALANCE_THRESHOLD,
      nextExpiry: row.next_expiry,
      paid: row.paid,
      total: row.total,
      weekly: row.weekly,
      zeroBalance: row.total === 0,
    };
  }

  getBreakdown(userId: string): Promise<CreditBalanceView> {
    return this.getBalance(userId);
  }

  async grantWelcome(userId: string): Promise<ReturnType<typeof transactionView>> {
    return transactionView(await this.repository.grantWelcome(userId, this.now()));
  }

  grantWeekly(): Promise<number> {
    return this.repository.grantWeekly(this.now());
  }

  async grantBonus(input: {
    userId: string;
    adminId: string;
    amount: number;
    reason: string;
    referenceId: string;
  }): Promise<ReturnType<typeof transactionView>> {
    return transactionView(await this.repository.grantBonus({ ...input, now: this.now() }));
  }

  async debit(input: {
    userId: string;
    amount: number;
    type: 'ai_usage' | 'document_usage' | 'adjustment' | 'reversal';
    source: string;
    referenceId: string;
    reason?: string | undefined;
  }): Promise<Array<ReturnType<typeof transactionView>>> {
    try {
      const rows = await this.repository.debitCredits({
        ...input,
        now: this.now(),
        reason: input.reason ?? null,
      });
      return rows.map(transactionView);
    } catch (error) {
      if (error instanceof InsufficientCreditsError)
        throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits');
      throw error;
    }
  }

  async refund(input: {
    userId: string;
    amount: number;
    bucketType: CreditBucketType;
    source: string;
    referenceId: string;
    expiresAt?: Date | null | undefined;
    reason?: string | undefined;
  }): Promise<ReturnType<typeof transactionView>> {
    return transactionView(
      await this.repository.grantCredit({
        ...input,
        expiresAt: input.expiresAt ?? null,
        now: this.now(),
        reason: input.reason ?? null,
        type: 'refund',
      }),
    );
  }

  async history(
    input: Omit<Parameters<FinanceRepository['listCreditTransactions']>[0], 'userId'> & {
      userId: string;
    },
  ): Promise<CreditTransactionPage> {
    const result = await this.repository.listCreditTransactions(input);
    return {
      items: result.items.map(transactionView),
      limit: input.limit,
      page: input.page,
      total: result.total,
    };
  }

  async products(language: Language): Promise<CreditProductView[]> {
    return (await this.repository.listCreditProducts()).map((row) => productView(row, language));
  }

  async acceptBalance(userId: string): Promise<MarketplaceAcceptBalanceView> {
    const lawyerId = await this.repository.getApprovedLawyerId(userId);
    if (!lawyerId)
      throw new AppError(403, 'LAWYER_NOT_VERIFIED', 'Approved lawyer profile is required');
    const row = await this.repository.getAcceptBalance(lawyerId, this.now());
    return { balance: row.balance, nextExpiry: row.next_expiry };
  }

  async acceptProducts(
    userId: string,
    language: Language,
  ): Promise<MarketplaceAcceptProductView[]> {
    if (!(await this.repository.getApprovedLawyerId(userId)))
      throw new AppError(403, 'LAWYER_NOT_VERIFIED', 'Approved lawyer profile is required');
    return (await this.repository.listAcceptProducts()).map((row) => ({
      acceptCount: row.accept_count,
      code: row.code,
      currency: 'UZS',
      expiresInDays: row.expires_in_days,
      id: row.id,
      name: localizedName(row, language),
      price: row.price,
    }));
  }
}
