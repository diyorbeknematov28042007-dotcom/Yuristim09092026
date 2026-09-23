import type { Database } from './database.types.js';

export type CreditTransactionRow = Database['public']['Tables']['credit_transactions']['Row'];
export type CreditProductRow = Database['public']['Tables']['credit_products']['Row'];
export type AcceptTransactionRow =
  Database['public']['Tables']['marketplace_accept_transactions']['Row'];
export type AcceptProductRow = Database['public']['Tables']['marketplace_accept_products']['Row'];
export type PaymentRow = Database['public']['Tables']['payments']['Row'];

export interface CreditBalanceRow {
  total: number;
  paid: number;
  weekly: number;
  bonus: number;
  next_expiry: string | null;
}

export interface AcceptBalanceRow {
  balance: number;
  next_expiry: string | null;
}

export interface CreditHistoryInput {
  userId: string;
  page: number;
  limit: number;
  type?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface PaymentWebhookResult {
  paymentId: string;
  status: string;
  processed: boolean;
}

export class InsufficientCreditsError extends Error {
  constructor() {
    super('Insufficient credits');
    this.name = 'InsufficientCreditsError';
  }
}

export class PaymentStateError extends Error {
  constructor() {
    super('Invalid payment state');
    this.name = 'PaymentStateError';
  }
}

export class PaymentNotFoundError extends Error {
  constructor() {
    super('Payment not found');
    this.name = 'PaymentNotFoundError';
  }
}

export interface FinanceRepository {
  getCreditBalance(userId: string, now: Date): Promise<CreditBalanceRow>;
  listCreditTransactions(
    input: CreditHistoryInput,
  ): Promise<{ items: CreditTransactionRow[]; total: number }>;
  listCreditProducts(): Promise<CreditProductRow[]>;
  findCreditProductById(id: string): Promise<CreditProductRow | null>;
  grantWelcome(userId: string, now: Date): Promise<CreditTransactionRow>;
  grantWeekly(now: Date): Promise<number>;
  grantBonus(input: {
    userId: string;
    adminId: string;
    amount: number;
    reason: string;
    referenceId: string;
    now: Date;
  }): Promise<CreditTransactionRow>;
  grantCredit(input: {
    userId: string;
    type: string;
    bucketType: string;
    amount: number;
    source: string;
    referenceId: string;
    expiresAt: Date | null;
    reason: string | null;
    now: Date;
  }): Promise<CreditTransactionRow>;
  debitCredits(input: {
    userId: string;
    amount: number;
    type: string;
    source: string;
    referenceId: string;
    reason: string | null;
    now: Date;
  }): Promise<CreditTransactionRow[]>;

  getApprovedLawyerId(userId: string): Promise<string | null>;
  getAcceptBalance(lawyerId: string, now: Date): Promise<AcceptBalanceRow>;
  listAcceptProducts(): Promise<AcceptProductRow[]>;
  findAcceptProductById(id: string): Promise<AcceptProductRow | null>;
  grantAccepts(input: {
    lawyerId: string;
    amount: number;
    type: string;
    referenceId: string;
    expiresAt: Date | null;
    now: Date;
  }): Promise<AcceptTransactionRow>;
  debitAccept(input: {
    lawyerId: string;
    referenceId: string;
    now: Date;
  }): Promise<AcceptTransactionRow>;

  createPayment(input: Database['public']['Tables']['payments']['Insert']): Promise<PaymentRow>;
  findPaymentById(id: string): Promise<PaymentRow | null>;
  findPaymentByIdempotencyKey(idempotencyKey: string): Promise<PaymentRow | null>;
  processPaymentWebhook(input: {
    paymentId: string;
    provider: string;
    providerPaymentId: string;
    status: 'paid' | 'failed' | 'cancelled';
    now: Date;
  }): Promise<PaymentWebhookResult>;
}
