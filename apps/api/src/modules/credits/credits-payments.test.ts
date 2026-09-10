import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppError } from '../../lib/errors.js';
import { MemoryFinanceRepository } from '../../testing/memory-finance-repository.js';
import { CreditService } from './service.js';
import {
  PaymentService,
  SandboxPaymentAdapter,
  type PaymentWebhookEvent,
} from '../payments/service.js';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const WEBHOOK_SECRET = 'sandbox-webhook-secret-at-least-thirty-two-characters';

function fixture() {
  const repository = new MemoryFinanceRepository();
  const now = () => NOW;
  const credits = new CreditService(repository, now);
  const adapter = new SandboxPaymentAdapter(WEBHOOK_SECRET);
  const payments = new PaymentService(repository, adapter, now);
  return { adapter, credits, payments, repository };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject<AppError>({ code });
}

describe('credit ledger lifecycle', () => {
  it('grants welcome credit exactly once and exposes an immutable-style history', async () => {
    const { credits, repository } = fixture();
    const userId = randomUUID();

    const first = await credits.grantWelcome(userId);
    const retry = await credits.grantWelcome(userId);

    expect(first.id).toBe(retry.id);
    expect(repository.transactions).toHaveLength(1);
    expect(await credits.getBalance(userId)).toMatchObject({ bonus: 50, total: 50 });
    expect(await credits.history({ limit: 5, page: 1, userId })).toMatchObject({
      items: [{ amount: 50, balanceAfter: 50, type: 'welcome_bonus' }],
      total: 1,
    });
  });

  it('grants one weekly bucket per Tashkent week and lets it expire', async () => {
    const { credits, repository } = fixture();
    const userId = randomUUID();
    await credits.grantWelcome(userId);

    expect(await credits.grantWeekly()).toBe(1);
    expect(await credits.grantWeekly()).toBe(0);
    expect(await credits.getBalance(userId)).toMatchObject({ total: 62, weekly: 12 });

    const afterBoundary = new CreditService(repository, () => new Date('2026-09-14T00:00:00.000Z'));
    expect(await afterBoundary.getBalance(userId)).toMatchObject({ total: 50, weekly: 0 });
  });

  it('keeps paid credit non-expiring and supports optional bonus expiry', async () => {
    const { credits, repository } = fixture();
    const userId = randomUUID();
    await repository.grantCredit({
      amount: 10,
      bucketType: 'paid',
      expiresAt: null,
      now: NOW,
      reason: 'Purchase',
      referenceId: 'paid-1',
      source: 'sandbox',
      type: 'purchase',
      userId,
    });
    await repository.grantCredit({
      amount: 4.5,
      bucketType: 'bonus',
      expiresAt: new Date('2026-09-10T00:00:00.000Z'),
      now: NOW,
      reason: 'Expiring campaign',
      referenceId: 'bonus-1',
      source: 'campaign',
      type: 'student_bonus',
      userId,
    });

    expect(await credits.getBalance(userId)).toMatchObject({ bonus: 4.5, paid: 10, total: 14.5 });
    const later = new CreditService(repository, () => new Date('2027-01-01T00:00:00.000Z'));
    expect(await later.getBalance(userId)).toMatchObject({ bonus: 0, paid: 10, total: 10 });
  });

  it('debits fractionally in weekly, expiring bonus, bonus, then paid order', async () => {
    const { credits, repository } = fixture();
    const userId = randomUUID();
    await credits.grantWelcome(userId);
    await credits.grantWeekly();
    await repository.grantCredit({
      amount: 3,
      bucketType: 'bonus',
      expiresAt: new Date('2026-09-12T00:00:00.000Z'),
      now: NOW,
      reason: 'Expiring bonus',
      referenceId: 'expiring',
      source: 'test',
      type: 'student_bonus',
      userId,
    });
    await repository.grantCredit({
      amount: 20,
      bucketType: 'paid',
      expiresAt: null,
      now: NOW,
      reason: 'Purchase',
      referenceId: 'purchase',
      source: 'sandbox',
      type: 'purchase',
      userId,
    });

    const rows = await credits.debit({
      amount: 66.5,
      referenceId: 'usage-1',
      source: 'phase7-test',
      type: 'ai_usage',
      userId,
    });

    expect(rows.map((row) => [row.bucketType, row.amount])).toEqual([
      ['weekly', -12],
      ['bonus', -3],
      ['bonus', -50],
      ['paid', -1.5],
    ]);
    expect(await credits.getBalance(userId)).toMatchObject({ paid: 18.5, total: 18.5 });
    expect(
      await credits.debit({
        amount: 66.5,
        referenceId: 'usage-1',
        source: 'phase7-test',
        type: 'ai_usage',
        userId,
      }),
    ).toHaveLength(4);
    expect(repository.transactions.filter((row) => row.amount < 0)).toHaveLength(4);
  });

  it('rejects an insufficient debit and records refunds without deleting history', async () => {
    const { credits, repository } = fixture();
    const userId = randomUUID();
    await credits.grantWelcome(userId);
    await expectCode(
      credits.debit({
        amount: 50.1,
        referenceId: 'too-much',
        source: 'test',
        type: 'document_usage',
        userId,
      }),
      'INSUFFICIENT_CREDITS',
    );
    await credits.refund({
      amount: 5,
      bucketType: 'bonus',
      reason: 'Usage reversal',
      referenceId: 'refund-1',
      source: 'support',
      userId,
    });
    expect(await credits.getBalance(userId)).toMatchObject({ total: 55 });
    expect(repository.transactions.map((row) => row.type)).toEqual(['welcome_bonus', 'refund']);
  });

  it('grants admin bonus idempotently with an audit record', async () => {
    const { credits, repository } = fixture();
    const input = {
      adminId: randomUUID(),
      amount: 25,
      reason: 'Support resolution',
      referenceId: 'admin-request-1',
      userId: randomUUID(),
    };
    const first = await credits.grantBonus(input);
    const retry = await credits.grantBonus(input);
    expect(first.id).toBe(retry.id);
    expect(repository.auditLogs).toEqual([{ action: 'credits.admin_bonus', entityId: first.id }]);
  });
});

describe('marketplace accept balance foundation', () => {
  it('keeps accept units separate, supports packages, usage, and expiry', async () => {
    const { credits, repository } = fixture();
    const userId = randomUUID();
    const lawyerId = randomUUID();
    repository.approvedLawyers.set(userId, lawyerId);
    repository.seedAcceptProduct();
    await credits.grantWelcome(userId);
    await repository.grantAccepts({
      amount: 5,
      expiresAt: new Date('2026-09-20T00:00:00.000Z'),
      lawyerId,
      now: NOW,
      referenceId: 'package-1',
      type: 'purchase',
    });
    await repository.debitAccept({ lawyerId, now: NOW, referenceId: 'listing-1' });

    expect(await credits.acceptBalance(userId)).toMatchObject({ balance: 4 });
    expect((await credits.acceptProducts(userId, 'uz'))[0]).toMatchObject({ price: 9900 });
    expect(await credits.getBalance(userId)).toMatchObject({ total: 50 });
    const expired = new CreditService(repository, () => new Date('2026-09-21T00:00:00.000Z'));
    expect(await expired.acceptBalance(userId)).toMatchObject({ balance: 0 });
  });

  it('hides accept products and balance from unverified users', async () => {
    const { credits } = fixture();
    await expectCode(credits.acceptBalance(randomUUID()), 'LAWYER_NOT_VERIFIED');
    await expectCode(credits.acceptProducts(randomUUID(), 'en'), 'LAWYER_NOT_VERIFIED');
  });
});

describe('provider-neutral payment lifecycle', () => {
  it('creates one pending checkout per idempotency key', async () => {
    const { payments, repository } = fixture();
    const product = repository.seedCreditProduct();
    const input = {
      idempotencyKey: 'checkout-unique-1',
      productId: product.id,
      productType: 'credits' as const,
      userId: randomUUID(),
    };
    const first = await payments.checkout(input);
    const retry = await payments.checkout(input);
    expect(first).toMatchObject({ checkoutUrl: null, provider: 'sandbox', status: 'pending' });
    expect(retry.id).toBe(first.id);
    expect(repository.payments).toHaveLength(1);
  });

  it('rejects missing, inactive, and unauthorized products', async () => {
    const { payments, repository } = fixture();
    const userId = randomUUID();
    await expectCode(
      payments.checkout({
        idempotencyKey: 'missing-product',
        productId: randomUUID(),
        productType: 'credits',
        userId,
      }),
      'INVALID_CREDIT_PRODUCT',
    );
    const inactive = repository.seedCreditProduct({ active: false });
    await expectCode(
      payments.checkout({
        idempotencyKey: 'inactive-product',
        productId: inactive.id,
        productType: 'credits',
        userId,
      }),
      'CREDIT_PRODUCT_INACTIVE',
    );
    const accepts = repository.seedAcceptProduct();
    await expectCode(
      payments.checkout({
        idempotencyKey: 'unverified-accept',
        productId: accepts.id,
        productType: 'marketplace_accepts',
        userId,
      }),
      'LAWYER_NOT_VERIFIED',
    );
  });

  it('verifies signatures and credits a paid webhook exactly once under concurrency', async () => {
    const { adapter, payments, repository } = fixture();
    const userId = randomUUID();
    const product = repository.seedCreditProduct({ credit_amount: 100 });
    const payment = await payments.checkout({
      idempotencyKey: 'paid-concurrent',
      productId: product.id,
      productType: 'credits',
      userId,
    });
    const event: PaymentWebhookEvent = {
      paymentId: payment.id,
      providerPaymentId: 'sandbox-payment-1',
      status: 'paid',
    };
    await expectCode(payments.webhook('sandbox', event, 'wrong'), 'PAYMENT_VERIFICATION_FAILED');
    const signature = adapter.signForTest(event);
    const results = await Promise.all([
      payments.webhook('sandbox', event, signature),
      payments.webhook('sandbox', event, signature),
    ]);
    expect(results.map((result) => result.processed).sort()).toEqual([false, true]);
    expect(repository.transactions.filter((row) => row.type === 'purchase')).toHaveLength(1);
    expect(await new CreditService(repository, () => NOW).getBalance(userId)).toMatchObject({
      paid: 100,
      total: 100,
    });
  });

  it('returns a clean error for a correctly signed unknown payment', async () => {
    const { adapter, payments } = fixture();
    const event: PaymentWebhookEvent = {
      paymentId: randomUUID(),
      providerPaymentId: 'missing-provider-id',
      status: 'paid',
    };
    await expectCode(
      payments.webhook('sandbox', event, adapter.signForTest(event)),
      'PAYMENT_NOT_FOUND',
    );
  });

  it.each(['failed', 'cancelled'] as const)('%s payments never grant value', async (status) => {
    const { adapter, payments, repository } = fixture();
    const userId = randomUUID();
    const product = repository.seedCreditProduct();
    const payment = await payments.checkout({
      idempotencyKey: `terminal-${status}`,
      productId: product.id,
      productType: 'credits',
      userId,
    });
    const event: PaymentWebhookEvent = {
      paymentId: payment.id,
      providerPaymentId: `sandbox-${status}`,
      status,
    };
    await payments.webhook('sandbox', event, adapter.signForTest(event));
    expect(repository.transactions).toHaveLength(0);
    expect((await payments.get(payment.id, userId)).status).toBe(status);
  });

  it('credits purchased accept units once and protects terminal payment state', async () => {
    const { adapter, credits, payments, repository } = fixture();
    const userId = randomUUID();
    const lawyerId = randomUUID();
    repository.approvedLawyers.set(userId, lawyerId);
    const product = repository.seedAcceptProduct({ accept_count: 3 });
    const payment = await payments.checkout({
      idempotencyKey: 'accept-checkout',
      productId: product.id,
      productType: 'marketplace_accepts',
      userId,
    });
    const paid: PaymentWebhookEvent = {
      paymentId: payment.id,
      providerPaymentId: 'accept-provider-id',
      status: 'paid',
    };
    await payments.webhook('sandbox', paid, adapter.signForTest(paid));
    expect(await credits.acceptBalance(userId)).toMatchObject({ balance: 3 });

    const failed: PaymentWebhookEvent = { ...paid, status: 'failed' };
    await expectCode(
      payments.webhook('sandbox', failed, adapter.signForTest(failed)),
      'INVALID_PAYMENT_STATE',
    );
    const mismatched: PaymentWebhookEvent = { ...paid, providerPaymentId: 'different-id' };
    await expectCode(
      payments.webhook('sandbox', mismatched, adapter.signForTest(mismatched)),
      'INVALID_PAYMENT_STATE',
    );
  });

  it('restricts payment lookup to its owner', async () => {
    const { payments, repository } = fixture();
    const product = repository.seedCreditProduct();
    const owner = randomUUID();
    const payment = await payments.checkout({
      idempotencyKey: 'owner-test',
      productId: product.id,
      productType: 'credits',
      userId: owner,
    });
    expect((await payments.get(payment.id, owner)).id).toBe(payment.id);
    await expectCode(payments.get(payment.id, randomUUID()), 'PAYMENT_NOT_FOUND');
  });
});
