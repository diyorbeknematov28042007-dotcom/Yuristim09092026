import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { MemoryCoreRepository } from '../../testing/memory-core-repository.js';
import { MemoryFinanceRepository } from '../../testing/memory-finance-repository.js';
import { MemoryLawyerRepository } from '../../testing/memory-lawyer-repository.js';
import { AdminService } from '../admin/service.js';
import type { PinHasher } from '../auth/crypto.js';
import { CoreAuthService } from '../auth/service.js';
import { CreditService } from '../credits/service.js';
import { PaymentService, SandboxPaymentAdapter } from './service.js';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const SESSION_SECRET = 'session-secret-at-least-thirty-two-characters';
const WEBHOOK_SECRET = 'webhook-secret-at-least-thirty-two-characters';
const pinHasher: PinHasher = {
  hash: (pin) => Promise.resolve(`hash:${pin}`),
  verify: (digest, pin) => Promise.resolve(digest === `hash:${pin}`),
};

describe('credits and payments HTTP API', () => {
  let app: FastifyInstance;
  let finance: MemoryFinanceRepository;
  let credits: CreditService;
  let payments: PaymentService;
  let adapter: SandboxPaymentAdapter;
  let userId: string;
  let userCookie: string;
  let adminCookie: string;

  beforeEach(async () => {
    const core = new MemoryCoreRepository();
    const user = core.seedUser({
      language: 'uz',
      onboarding_role: 'user',
      onboarding_status: 'completed',
      pin_hash: 'hash:0001',
      terms_accepted_at: NOW.toISOString(),
      terms_version: '2026-09',
    });
    userId = user.id;
    const lawyers = new MemoryLawyerRepository(core);
    const auth = new CoreAuthService(core, {
      challengeTtlSeconds: 600,
      now: () => NOW,
      pinHasher,
      sessionSecret: SESSION_SECRET,
      sessionTtlSeconds: 3600,
    });
    const admin = new AdminService(lawyers, {
      now: () => NOW,
      sessionSecret: SESSION_SECRET,
      sessionTtlSeconds: 3600,
    });
    await admin.bootstrap('phase5admin', 'very-secure-phase5-password');
    finance = new MemoryFinanceRepository();
    credits = new CreditService(finance, () => NOW);
    adapter = new SandboxPaymentAdapter(WEBHOOK_SECRET);
    payments = new PaymentService(finance, adapter, () => NOW);
    await credits.grantWelcome(userId);
    app = buildApp({
      core: {
        adminService: admin,
        creditService: credits,
        internalBotSecret: 'internal-secret-at-least-thirty-two-characters',
        paymentService: payments,
        production: false,
        service: auth,
      },
      logger: false,
    });
    const login = await app.inject({
      method: 'POST',
      payload: { duid: user.duid, pin: '0001' },
      url: '/auth/pin/verify',
    });
    userCookie = String(login.headers['set-cookie']).split(';', 1)[0]!;
    const adminLogin = await app.inject({
      method: 'POST',
      payload: { password: 'very-secure-phase5-password', username: 'phase5admin' },
      url: '/admin/auth/login',
    });
    adminCookie = String(adminLogin.headers['set-cookie']).split(';', 1)[0]!;
  });

  afterEach(async () => app.close());

  it('returns typed balance, filtered history, and only active priced products', async () => {
    finance.seedCreditProduct();
    finance.seedCreditProduct({
      active: false,
      code: 'draft_250',
      credit_amount: 250,
      price: null,
    });
    expect(
      (
        await app.inject({
          headers: { cookie: userCookie },
          method: 'GET',
          url: '/credits/balance',
        })
      ).json(),
    ).toMatchObject({ bonus: 50, total: 50, weekly: 0 });
    expect(
      (
        await app.inject({
          headers: { cookie: userCookie },
          method: 'GET',
          url: '/credits/transactions?type=welcome_bonus&page=1&limit=5',
        })
      ).json(),
    ).toMatchObject({ items: [{ type: 'welcome_bonus' }], limit: 5, total: 1 });
    expect(
      (
        await app.inject({
          headers: { cookie: userCookie },
          method: 'GET',
          url: '/credits/products?language=uz',
        })
      ).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
  });

  it('checks out, verifies its webhook, and exposes status only to owner or admin', async () => {
    const product = finance.seedCreditProduct({ credit_amount: 100 });
    const missingHeader = await app.inject({
      headers: { cookie: userCookie },
      method: 'POST',
      payload: { product_id: product.id, product_type: 'credits' },
      url: '/payments/checkout',
    });
    expect(missingHeader.statusCode).toBe(400);

    const checkout = await app.inject({
      headers: { cookie: userCookie, 'idempotency-key': 'route-checkout-1' },
      method: 'POST',
      payload: { product_id: product.id, product_type: 'credits' },
      url: '/payments/checkout',
    });
    expect(checkout.statusCode).toBe(201);
    const paymentId = checkout.json<{ id: string }>().id;
    expect(checkout.json()).toMatchObject({ checkoutUrl: null, status: 'pending' });
    expect(
      (
        await app.inject({
          headers: { cookie: userCookie },
          method: 'GET',
          url: `/payments/${paymentId}`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers: { cookie: adminCookie },
          method: 'GET',
          url: `/payments/${paymentId}`,
        })
      ).statusCode,
    ).toBe(200);

    const event = {
      paymentId,
      providerPaymentId: 'route-provider-1',
      status: 'paid' as const,
    };
    expect(
      (
        await app.inject({
          headers: { 'x-payment-signature': 'invalid' },
          method: 'POST',
          payload: event,
          url: '/webhooks/payments/sandbox',
        })
      ).statusCode,
    ).toBe(401);
    const paid = await app.inject({
      headers: { 'x-payment-signature': adapter.signForTest(event) },
      method: 'POST',
      payload: event,
      url: '/webhooks/payments/sandbox',
    });
    expect(paid.json()).toMatchObject({ payment: { status: 'paid' }, processed: true });
    expect((await credits.getBalance(userId)).total).toBe(150);
  });

  it('requires an admin reason and records a transactional bonus audit', async () => {
    const noReason = await app.inject({
      headers: { cookie: adminCookie, 'idempotency-key': 'admin-route-1' },
      method: 'POST',
      payload: { amount: 25, type: 'admin_bonus' },
      url: `/admin/users/${userId}/credits`,
    });
    expect(noReason.statusCode).toBe(400);
    const granted = await app.inject({
      headers: { cookie: adminCookie, 'idempotency-key': 'admin-route-1' },
      method: 'POST',
      payload: { amount: 25, reason: 'Support resolution', type: 'admin_bonus' },
      url: `/admin/users/${userId}/credits`,
    });
    expect(granted.statusCode).toBe(201);
    expect(granted.json()).toMatchObject({ transaction: { amount: 25, type: 'admin_bonus' } });
    expect(finance.auditLogs).toHaveLength(1);
  });

  it('rejects unauthenticated financial reads and invalid history filters', async () => {
    expect((await app.inject({ method: 'GET', url: '/credits/balance' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          headers: { cookie: userCookie },
          method: 'GET',
          url: '/credits/transactions?from=2026-09-11&to=2026-09-10',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          headers: { cookie: userCookie },
          method: 'GET',
          url: `/payments/${randomUUID()}`,
        })
      ).statusCode,
    ).toBe(404);
  });
});
