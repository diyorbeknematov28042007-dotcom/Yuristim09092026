import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D1AiProviderRepository, type D1AiProviderBinding } from './d1-ai-provider-repository.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
function binding(db: DatabaseSync): D1AiProviderBinding {
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
      };
    },
  };
}

describe('D1 AI provider leases and failover against SQLite', () => {
  let db: DatabaseSync;
  let repo: D1AiProviderRepository;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of [
      '0001_core_auth.sql',
      '0002_identifier_guards.sql',
      '0003_lawyer_admin.sql',
      '0004_finance.sql',
      '0005_payment_pending.sql',
      '0006_admin_bonus_audit.sql',
      '0007_marketplace.sql',
      '0008_ai.sql',
    ])
      db.exec(readFileSync(new URL(`../../../cloudflare/d1/${name}`, import.meta.url), 'utf8'));
    repo = new D1AiProviderRepository(binding(db));
  });
  afterEach(() => db.close());

  const failure = {
    provider: 'bai' as const,
    category: 'timeout' as const,
    now: NOW,
    failureThreshold: 3,
    failureWindowSeconds: 120,
    baseCooldownSeconds: 300,
    maxCooldownSeconds: 1800,
  };

  it('opens on threshold and grants only one probe after cooldown', async () => {
    expect(
      (await repo.acquireProvider({ provider: 'bai', now: NOW, halfOpenLeaseSeconds: 30 })).allowed,
    ).toBe(true);
    await repo.recordProviderFailure(failure);
    await repo.recordProviderFailure(failure);
    const opened = await repo.recordProviderFailure(failure);
    expect(opened).toMatchObject({
      circuitState: 'OPEN',
      consecutiveFailures: 3,
      cooldownSeconds: 300,
    });
    expect(opened.pausedUntil).toBe('2026-11-26T12:05:00.000Z');
    expect(
      (await repo.acquireProvider({ provider: 'bai', now: NOW, halfOpenLeaseSeconds: 30 })).allowed,
    ).toBe(false);
    const after = new Date('2026-11-26T12:05:01.000Z');
    const probes = await Promise.all([
      repo.acquireProvider({ provider: 'bai', now: after, halfOpenLeaseSeconds: 30 }),
      repo.acquireProvider({ provider: 'bai', now: after, halfOpenLeaseSeconds: 30 }),
    ]);
    expect(probes.filter((probe) => probe.allowed)).toHaveLength(1);
    expect((await repo.recordProviderFailure({ ...failure, now: after })).cooldownSeconds).toBe(
      600,
    );
    expect(
      (await repo.recordProviderSuccess({ provider: 'bai', now: after, baseCooldownSeconds: 300 }))
        .circuitState,
    ).toBe('ACTIVE');
  });

  it('respects manual pause and a rate limit immediately opens the circuit', async () => {
    expect(
      (
        await repo.recordProviderFailure({
          ...failure,
          category: 'rate_limit',
          retryAfterSeconds: 1000,
        })
      ).pausedUntil,
    ).toBe('2026-11-26T12:16:40.000Z');
    db.exec(
      "UPDATE ai_provider_runtime_state SET manual_enabled=0,circuit_state='MANUAL_PAUSED',paused_until=NULL WHERE provider='bai'",
    );
    expect(
      (
        await repo.acquireProvider({
          provider: 'bai',
          now: new Date('2026-11-27T12:00:00.000Z'),
          halfOpenLeaseSeconds: 30,
        })
      ).allowed,
    ).toBe(false);
    expect(
      (await repo.recordProviderSuccess({ provider: 'bai', now: NOW, baseCooldownSeconds: 300 }))
        .circuitState,
    ).toBe('MANUAL_PAUSED');
  });

  it('rejects invalid state transitions', async () => {
    await expect(
      repo.acquireProvider({ provider: 'bai', now: NOW, halfOpenLeaseSeconds: 0 }),
    ).rejects.toMatchObject({ databaseCode: '22023' });
    await expect(
      repo.recordProviderFailure({ ...failure, failureThreshold: 0 }),
    ).rejects.toMatchObject({ databaseCode: '22023' });
  });
});
