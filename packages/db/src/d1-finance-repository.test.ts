import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D1FinanceRepository, type D1FinanceBinding } from './d1-finance-repository.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const migrationNames = [
  '0001_core_auth.sql',
  '0002_identifier_guards.sql',
  '0003_lawyer_admin.sql',
  '0004_finance.sql',
  '0005_payment_pending.sql',
  '0006_admin_bonus_audit.sql',
];

function binding(db: DatabaseSync): D1FinanceBinding {
  return {
    prepare(sql: string) {
      let params: Array<string | number | null> = [];
      return {
        bind(...values: Array<string | number | null>) {
          params = values;
          return this;
        },
        async first<T>() {
          return (db.prepare(sql).get(...params) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...params) as T[] };
        },
        async run() {
          const result = db.prepare(sql).run(...params);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}

describe('D1 finance repository against real SQLite', () => {
  let db: DatabaseSync;
  let repo: D1FinanceRepository;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of migrationNames)
      db.exec(readFileSync(new URL(`../../../cloudflare/d1/${name}`, import.meta.url), 'utf8'));
    db.prepare(
      "INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES('u',42,'yr_abcdefghijklmnop',?)",
    ).run(NOW.toISOString());
    repo = new D1FinanceRepository(binding(db));
  });
  afterEach(() => db.close());

  it('preserves milli-credit precision, ordering and replay safety', async () => {
    db.prepare(
      "INSERT INTO admin_accounts(id,username,password_hash) VALUES('a','admin','hash')",
    ).run();
    const bonus = await repo.grantBonus({
      userId: 'u',
      adminId: 'a',
      amount: 0.001,
      reason: 'test bonus',
      referenceId: 'bonus:test',
      now: NOW,
    });
    expect(bonus.amount).toBe(0.001);
    expect(
      db.prepare("SELECT count(*) n FROM audit_logs WHERE action='credits.admin_bonus'").get(),
    ).toMatchObject({ n: 1 });
    const expiry = new Date('2026-11-30T19:00:00Z');
    await repo.grantCredit({
      userId: 'u',
      type: 'weekly_bonus',
      bucketType: 'weekly',
      amount: 12,
      source: 'weekly_cron',
      referenceId: '2026-W48',
      expiresAt: expiry,
      reason: null,
      now: NOW,
    });
    const debits = await repo.debitCredits({
      userId: 'u',
      amount: 12.001,
      type: 'ai_usage',
      source: 'ai_message',
      referenceId: 'message:1',
      reason: null,
      now: NOW,
    });
    expect(debits.map((x) => x.amount).sort((a, b) => a - b)).toEqual([-12, -0.001]);
    expect(await repo.getCreditBalance('u', NOW)).toMatchObject({
      total: 50,
      weekly: 0,
      bonus: 50,
    });
    expect(
      await repo.debitCredits({
        userId: 'u',
        amount: 12.001,
        type: 'ai_usage',
        source: 'ai_message',
        referenceId: 'message:1',
        reason: null,
        now: NOW,
      }),
    ).toHaveLength(2);
    await expect(
      repo.debitCredits({
        userId: 'u',
        amount: 51,
        type: 'ai_usage',
        source: 'ai_message',
        referenceId: 'message:2',
        reason: null,
        now: NOW,
      }),
    ).rejects.toThrow('Insufficient credits');
    expect((await repo.listCreditTransactions({ userId: 'u', page: 1, limit: 10 })).total).toBe(5);
  });

  it('applies payment and grant once through the same trigger', async () => {
    db.prepare(
      "UPDATE credit_products SET price_minor=10000,active=1 WHERE code='credits_100'",
    ).run();
    const created = await repo.createPayment({
      user_id: 'u',
      provider: 'sandbox',
      type: 'credits',
      amount_money: 100,
      product_id: 'credits_100',
      product_code: 'credits_100',
      product_units: 100,
      idempotency_key: 'checkout:1',
      currency: 'UZS',
      status: 'pending',
    });
    const event = {
      paymentId: created.id,
      provider: 'sandbox',
      providerPaymentId: 'provider:1',
      status: 'paid' as const,
      now: NOW,
    };
    expect((await repo.processPaymentWebhook(event)).processed).toBe(true);
    expect((await repo.processPaymentWebhook(event)).processed).toBe(false);
    expect((await repo.getCreditBalance('u', NOW)).total).toBe(150);
    await expect(
      repo.processPaymentWebhook({ ...event, providerPaymentId: 'provider:other' }),
    ).rejects.toThrow('Invalid payment state');
    expect((await repo.findPaymentByIdempotencyKey('checkout:1'))?.status).toBe('paid');
  });

  it('allocates a single accept and rejects concurrent overspending', async () => {
    db.prepare(
      "INSERT INTO lawyer_profiles(id,user_id,public_slug,verification_status) VALUES('l','u','lawyer','approved')",
    ).run();
    const payment = await repo.createPayment({
      user_id: 'u',
      provider: 'sandbox',
      type: 'marketplace_accepts',
      amount_money: 9900,
      product_id: 'single_accept',
      product_code: 'single_accept',
      product_units: 1,
      idempotency_key: 'checkout:2',
      currency: 'UZS',
      status: 'pending',
    });
    await repo.processPaymentWebhook({
      paymentId: payment.id,
      provider: 'sandbox',
      providerPaymentId: 'accept:1',
      status: 'paid',
      now: NOW,
    });
    const [one, two] = await Promise.allSettled([
      repo.debitAccept({ lawyerId: 'l', referenceId: 'post:1', now: NOW }),
      repo.debitAccept({ lawyerId: 'l', referenceId: 'post:2', now: NOW }),
    ]);
    expect([one.status, two.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect((await repo.getAcceptBalance('l', NOW)).balance).toBe(0);
  });

  it('grants weekly credits only once in the Tashkent ISO week', async () => {
    expect(await repo.grantWeekly(NOW)).toBe(1);
    expect(await repo.grantWeekly(NOW)).toBe(0);
    expect((await repo.getCreditBalance('u', NOW)).weekly).toBe(12);
  });

  it('does not allow two competing credit debits to spend the same balance', async () => {
    const outcomes = await Promise.allSettled([
      repo.debitCredits({
        userId: 'u',
        amount: 40,
        type: 'ai_usage',
        source: 'ai_message',
        referenceId: 'first',
        reason: null,
        now: NOW,
      }),
      repo.debitCredits({
        userId: 'u',
        amount: 40,
        type: 'ai_usage',
        source: 'ai_message',
        referenceId: 'second',
        reason: null,
        now: NOW,
      }),
    ]);
    expect(outcomes.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await repo.getCreditBalance('u', NOW)).total).toBe(10);
  });
});
