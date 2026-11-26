import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D1Founding100Repository, type D1Founding100Binding } from './d1-founding100-repository.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const files = [
  '0001_core_auth.sql',
  '0002_identifier_guards.sql',
  '0003_lawyer_admin.sql',
  '0004_finance.sql',
  '0005_payment_pending.sql',
  '0006_admin_bonus_audit.sql',
  '0007_marketplace.sql',
  '0008_ai.sql',
  '0009_documents.sql',
  '0010_founding100.sql',
  '0011_marketplace_lifecycle.sql',
  '0012_founding100_confirmation_events.sql',
];

function binding(db: DatabaseSync): D1Founding100Binding {
  return {
    prepare(sql: string) {
      let args: Array<string | number | null> = [];
      return {
        bind(...values: Array<string | number | null>) {
          args = values;
          return this;
        },
        async first<T>() {
          return (db.prepare(sql).get(...args) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...args) as T[] };
        },
        async run() {
          const result = db.prepare(sql).run(...args);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}
describe('D1 Founding 100 repository against SQLite', () => {
  let db: DatabaseSync;
  let repo: D1Founding100Repository;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of files)
      db.exec(readFileSync(new URL(`../../../cloudflare/d1/${name}`, import.meta.url), 'utf8'));
    db.prepare(
      "INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES('u',42,'yr_abcdefghijklmnop',?)",
    ).run(NOW.toISOString());
    repo = new D1Founding100Repository(binding(db));
  });
  afterEach(() => db.close());

  it('reserves once, confirms atomically and keeps event analytics', async () => {
    const input = {
      tokenHash: 'a'.repeat(64),
      idempotencyKey: 'reserve:one',
      source: 'direct',
      now: NOW,
    };
    const first = await repo.reserve(input);
    expect(first.duplicate).toBe(false);
    expect((await repo.reserve(input)).duplicate).toBe(true);
    expect((await repo.getStatus(NOW)).available).toBe(99);
    expect(
      (await repo.confirm({ tokenHash: input.tokenHash, userId: 'u', now: NOW })).duplicate,
    ).toBe(false);
    expect(
      (await repo.confirm({ tokenHash: input.tokenHash, userId: 'u', now: NOW })).duplicate,
    ).toBe(true);
    expect(await repo.recordOnboardingComplete('u', NOW)).toBe(true);
    const analytics = await repo.getAnalytics({
      from: new Date(NOW.getTime() - 1000),
      to: new Date(NOW.getTime() + 1000),
    });
    expect(analytics.totals.confirmed).toBe(1);
    expect(analytics.totals.onboardingCompleted).toBe(1);
    expect((await repo.getStatus(NOW)).confirmed).toBe(1);
  });

  it('enforces the 100-slot limit even with concurrent requests', async () => {
    const promises = Array.from({ length: 101 }, (_, i) =>
      repo.reserve({
        tokenHash: i.toString(16).padStart(64, '0'),
        idempotencyKey: `reservation:${i}`,
        source: 'direct',
        now: NOW,
      }),
    );
    const result = await Promise.allSettled(promises);
    expect(result.filter((x) => x.status === 'fulfilled')).toHaveLength(100);
    expect(result.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect((await repo.getStatus(NOW)).available).toBe(0);
  });
  it('confirms only one reservation per user under competing claims', async () => {
    const first = await repo.reserve({
      tokenHash: 'a'.repeat(64),
      idempotencyKey: 'reserve:first',
      source: 'direct',
      now: NOW,
    });
    const second = await repo.reserve({
      tokenHash: 'b'.repeat(64),
      idempotencyKey: 'reserve:second',
      source: 'direct',
      now: NOW,
    });
    const results = await Promise.all([
      repo.confirm({ tokenHash: 'a'.repeat(64), userId: 'u', now: NOW }),
      repo.confirm({ tokenHash: 'b'.repeat(64), userId: 'u', now: NOW }),
    ]);
    expect(results[0]?.reservationId).toBe(results[1]?.reservationId);
    expect([first.id, second.id]).toContain(results[0]?.reservationId);
    expect((await repo.getStatus(NOW)).confirmed).toBe(1);
  });
});
