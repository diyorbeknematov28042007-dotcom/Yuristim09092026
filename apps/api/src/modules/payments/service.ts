import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PaymentNotFoundError,
  PaymentStateError,
  type FinanceRepository,
  type PaymentRow,
} from '@yuristim/db';
import type { PaymentProductType, PaymentStatus, PaymentView } from '@yuristim/types';
import { AppError } from '../../lib/errors.js';

export interface PaymentWebhookEvent {
  paymentId: string;
  providerPaymentId: string;
  status: 'paid' | 'failed' | 'cancelled';
}

export type CheckoutProductType = Exclude<PaymentProductType, 'profile_tariff'>;

export interface PaymentProviderAdapter {
  readonly name: string;
  checkoutUrl(payment: PaymentRow): Promise<string | null>;
  verifyWebhook(event: PaymentWebhookEvent, signature: string): boolean;
}

function webhookMessage(event: PaymentWebhookEvent): string {
  return `${event.paymentId}.${event.providerPaymentId}.${event.status}`;
}

export class SandboxPaymentAdapter implements PaymentProviderAdapter {
  readonly name = 'sandbox';

  constructor(private readonly webhookSecret: string) {}

  checkoutUrl(): Promise<null> {
    return Promise.resolve(null);
  }

  verifyWebhook(event: PaymentWebhookEvent, signature: string): boolean {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const expected = createHmac('sha256', this.webhookSecret)
      .update(webhookMessage(event))
      .digest();
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  signForTest(event: PaymentWebhookEvent): string {
    return createHmac('sha256', this.webhookSecret).update(webhookMessage(event)).digest('hex');
  }
}

function paymentView(row: PaymentRow, checkoutUrl: string | null = null): PaymentView {
  return {
    amountMoney: row.amount_money,
    checkoutUrl,
    createdAt: row.created_at,
    currency: 'UZS',
    failedAt: row.failed_at,
    id: row.id,
    paidAt: row.paid_at,
    productCode: row.product_code,
    productId: row.product_id,
    productType: row.type as PaymentProductType,
    productUnits: row.product_units,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    status: row.status as PaymentStatus,
  };
}

export class PaymentService {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly adapter: PaymentProviderAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async checkout(input: {
    userId: string;
    productType: CheckoutProductType;
    productId: string;
    idempotencyKey: string;
  }): Promise<PaymentView> {
    const existing = await this.repository.findPaymentByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (
        existing.user_id !== input.userId ||
        existing.type !== input.productType ||
        existing.product_id !== input.productId
      )
        throw new AppError(409, 'INVALID_PAYMENT_STATE', 'Idempotency key was reused');
      return paymentView(existing, await this.adapter.checkoutUrl(existing));
    }

    let product: {
      active: boolean;
      code: string;
      id: string;
      price: number | null;
      units: number | null;
    };
    if (input.productType === 'credits') {
      const row = await this.repository.findCreditProductById(input.productId);
      if (!row) throw new AppError(404, 'INVALID_CREDIT_PRODUCT', 'Credit product was not found');
      product = {
        active: row.active,
        code: row.code,
        id: row.id,
        price: row.price,
        units: row.credit_amount,
      };
      if (!product.active || product.price === null || product.units === null)
        throw new AppError(409, 'CREDIT_PRODUCT_INACTIVE', 'Credit product is not available');
    } else {
      if (!(await this.repository.getApprovedLawyerId(input.userId)))
        throw new AppError(403, 'LAWYER_NOT_VERIFIED', 'Approved lawyer profile is required');
      const row = await this.repository.findAcceptProductById(input.productId);
      if (!row) throw new AppError(404, 'INVALID_ACCEPT_PRODUCT', 'Accept product was not found');
      product = {
        active: row.active,
        code: row.code,
        id: row.id,
        price: row.price,
        units: row.accept_count,
      };
      if (!product.active)
        throw new AppError(409, 'ACCEPT_PRODUCT_INACTIVE', 'Accept product is not available');
    }

    try {
      const payment = await this.repository.createPayment({
        amount_money: product.price!,
        currency: 'UZS',
        idempotency_key: input.idempotencyKey,
        product_code: product.code,
        product_id: product.id,
        product_units: product.units!,
        provider: this.adapter.name,
        status: 'pending',
        type: input.productType,
        user_id: input.userId,
      });
      return paymentView(payment, await this.adapter.checkoutUrl(payment));
    } catch (error) {
      const concurrent = await this.repository.findPaymentByIdempotencyKey(input.idempotencyKey);
      if (concurrent) return paymentView(concurrent, await this.adapter.checkoutUrl(concurrent));
      throw error;
    }
  }

  async get(id: string, ownerId?: string): Promise<PaymentView> {
    const payment = await this.repository.findPaymentById(id);
    if (!payment || (ownerId && payment.user_id !== ownerId))
      throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found');
    return paymentView(payment);
  }

  async webhook(
    provider: string,
    event: PaymentWebhookEvent,
    signature: string,
  ): Promise<{ payment: PaymentView; processed: boolean }> {
    if (provider !== this.adapter.name || !this.adapter.verifyWebhook(event, signature))
      throw new AppError(401, 'PAYMENT_VERIFICATION_FAILED', 'Payment webhook verification failed');
    try {
      const result = await this.repository.processPaymentWebhook({
        ...event,
        now: this.now(),
        provider,
      });
      return { payment: await this.get(result.paymentId), processed: result.processed };
    } catch (error) {
      if (error instanceof PaymentNotFoundError)
        throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found');
      if (error instanceof PaymentStateError)
        throw new AppError(409, 'INVALID_PAYMENT_STATE', 'Payment state transition is invalid');
      throw error;
    }
  }
}
