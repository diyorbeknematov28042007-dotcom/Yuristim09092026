import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D1AdminRepository, type D1AdminBinding } from './d1-admin-repository.js';

const NOW = new Date();
function binding(db: DatabaseSync): D1AdminBinding {
  return {
    prepare(sql: string) {
      let values: Array<string | number | null> = [];
      return {
        bind(...args: Array<string | number | null>) {
          values = args;
          return this;
        },
        async first<T>() {
          return (db.prepare(sql).get(...values) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...values) as T[] };
        },
        async run() {
          return db.prepare(sql).run(...values);
        },
      };
    },
  };
}

describe('D1 admin authentication persistence', () => {
  let db: DatabaseSync;
  let repo: D1AdminRepository;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of [
      '0001_core_auth.sql',
      '0002_identifier_guards.sql',
      '0003_lawyer_admin.sql',
    ])
      db.exec(readFileSync(new URL(`../../../cloudflare/d1/${name}`, import.meta.url), 'utf8'));
    repo = new D1AdminRepository(binding(db));
  });
  afterEach(() => db.close());

  it('creates admins and persists hashed sessions; revocation is idempotent', async () => {
    const admin = await repo.createAdmin('admin', '$argon2id$hash');
    expect((await repo.findAdminByUsername('admin'))?.id).toBe(admin.id);
    const expiresAt = new Date(NOW.getTime() + 60_000);
    const session = await repo.createAdminSession({
      adminId: admin.id,
      tokenHash: 'hash-of-secret-only',
      now: NOW,
      expiresAt,
    });
    expect((await repo.findAdminSessionByTokenHash('hash-of-secret-only'))?.admin_id).toBe(
      admin.id,
    );
    await repo.touchAdminSession(session.id, new Date(NOW.getTime() + 30_000));
    expect((await repo.findAdminSessionByTokenHash('hash-of-secret-only'))?.last_seen_at).toBe(
      new Date(NOW.getTime() + 30_000).toISOString(),
    );
    await repo.revokeAdminSession(session.id, new Date(NOW.getTime() + 31_000));
    await repo.revokeAdminSession(session.id, new Date(NOW.getTime() + 32_000));
    await repo.touchAdminSession(session.id, new Date(NOW.getTime() + 33_000));
    const revoked = await repo.findAdminSessionByTokenHash('hash-of-secret-only');
    expect(revoked?.last_seen_at).toBe(new Date(NOW.getTime() + 30_000).toISOString());
    expect(revoked?.revoked_at).toBe(new Date(NOW.getTime() + 31_000).toISOString());
    await expect(
      repo.createAdminSession({
        adminId: 'blocked-or-nonexistent',
        tokenHash: 'invalid',
        now: NOW,
        expiresAt,
      }),
    ).rejects.toThrow('D1 row missing');
  });

  it('counts concurrent login failures in SQL and locks after the fifth attempt', async () => {
    const admin = await repo.createAdmin('moderator', 'hash');
    const update = { failed_login_attempts: 1, locked_until: null };
    const firstFive = await Promise.all(
      Array.from({ length: 5 }, () => repo.updateAdminLoginState(admin.id, update)),
    );
    expect(firstFive.map((row) => row.failed_login_attempts).sort()).toEqual([1, 2, 3, 4, 5]);
    const locked = await repo.findAdminById(admin.id);
    expect(new Date(locked!.locked_until!).getTime()).toBeGreaterThan(Date.now());
    expect((await repo.updateAdminLoginState(admin.id, update)).failed_login_attempts).toBe(5);
    await repo.logAdminLogin({
      adminId: admin.id,
      username: admin.username,
      success: false,
      ip: null,
      userAgent: 'test',
      now: NOW,
    });
    expect(db.prepare('SELECT COUNT(*) AS total FROM admin_login_logs').get()).toEqual({
      total: 1,
    });
    expect(() => db.prepare('DELETE FROM admin_login_logs').run()).toThrow();
  });

  it('reports Tashkent day windows and recent users without loading the entire table', async () => {
    const localMorning = new Date('2026-11-26T00:15:00.000Z');
    db.prepare(
      `INSERT INTO users(id,telegram_user_id,duid,created_at)
      VALUES('today',10,'yr_abcdefghijklmnop','2026-11-25T19:01:00.000Z'),
            ('yesterday',11,'yr_abcdefghijklmnox','2026-11-25T18:59:00.000Z')`,
    ).run();
    const stats = await repo.getAdminUserStats(localMorning);
    expect(stats.totalUsers).toBe(2);
    expect(stats.todayUsers).toBe(1);
    expect(stats.last7DaysUsers).toBe(2);
    expect(stats.recentUsers.map((item) => item.id)).toEqual(['today', 'yesterday']);
  });
});
