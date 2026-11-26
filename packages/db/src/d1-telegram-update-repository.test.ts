import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  D1TelegramUpdateRepository,
  type D1TelegramUpdateBinding,
} from './d1-telegram-update-repository.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
function binding(db: DatabaseSync): D1TelegramUpdateBinding {
  function prepare(sql: string) {
    let args: Array<string | number | null> = [];
    return {
      bind(...values: Array<string | number | null>) {
        args = values;
        return this;
      },
      async first<T>() {
        return (db.prepare(sql).get(...args) as T | undefined) ?? null;
      },
      query() {
        return { sql, args };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          const { sql, args } = (statement as ReturnType<typeof prepare>).query();
          if (/RETURNING\s+/i.test(sql)) results.push({ results: db.prepare(sql).all(...args) });
          else {
            db.prepare(sql).run(...args);
            results.push({ results: [] });
          }
        }
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
describe('D1 Telegram webhook claim concurrency', () => {
  let db: DatabaseSync;
  let repo: D1TelegramUpdateRepository;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(
      readFileSync(
        new URL('../../../cloudflare/d1/0015_telegram_updates.sql', import.meta.url),
        'utf8',
      ),
    );
    repo = new D1TelegramUpdateRepository(binding(db));
  });
  afterEach(() => db.close());

  it('deduplicates successful updates and serializes a chat', async () => {
    const first = await repo.claim(1, 42, NOW);
    expect(first.status).toBe('acquired');
    expect((await repo.claim(1, 42, NOW)).status).toBe('busy');
    expect((await repo.claim(2, 42, NOW)).status).toBe('busy');
    expect((await repo.claim(3, 43, NOW)).status).toBe('acquired');
    if (first.status !== 'acquired') throw new Error('Missing lease');
    expect(await repo.finish(1, first.leaseId, true, NOW)).toBe(true);
    expect((await repo.claim(1, 42, NOW)).status).toBe('completed');
    expect((await repo.claim(2, 42, NOW)).status).toBe('acquired');
    expect(await repo.finish(1, first.leaseId, false, NOW)).toBe(false);
  });
  it('retries failed and expired leases, rejects stale completion', async () => {
    const initial = await repo.claim(1, 42, NOW);
    if (initial.status !== 'acquired') throw new Error('Missing lease');
    expect(await repo.finish(1, initial.leaseId, false, NOW)).toBe(true);
    const retried = await repo.claim(1, 42, NOW);
    expect(retried.status).toBe('acquired');
    if (retried.status !== 'acquired') throw new Error('Missing retry lease');
    expect(await repo.finish(1, retried.leaseId, true, NOW)).toBe(true);
    const expired = await repo.claim(10, 55, NOW);
    if (expired.status !== 'acquired') throw new Error('Missing lease');
    const later = new Date(NOW.getTime() + 121_000);
    expect((await repo.claim(11, 55, later)).status).toBe('acquired');
    expect(await repo.finish(10, expired.leaseId, true, later)).toBe(false);
  });
});
