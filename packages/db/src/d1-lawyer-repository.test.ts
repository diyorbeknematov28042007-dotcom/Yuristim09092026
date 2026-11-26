import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D1LawyerRepository, type D1LawyerBinding } from './d1-lawyer-repository.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
function binding(db: DatabaseSync, count: { queries: number }): D1LawyerBinding {
  function prepare(sql: string) {
    count.queries++;
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
      query() {
        return { sql, values };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results: Array<{ results: unknown[] }> = [];
        for (const statement of statements) {
          const { sql, values } = (statement as ReturnType<typeof prepare>).query();
          if (/RETURNING\s+/i.test(sql)) results.push({ results: db.prepare(sql).all(...values) });
          else {
            db.prepare(sql).run(...values);
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

describe('complete D1 lawyer repository interface', () => {
  let db: DatabaseSync;
  let repo: D1LawyerRepository;
  let count: { queries: number };
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
      '0009_documents.sql',
      '0010_founding100.sql',
      '0011_marketplace_lifecycle.sql',
      '0012_founding100_confirmation_events.sql',
      '0013_ai_credit_atomicity.sql',
      '0014_ai_message_immutable.sql',
      '0015_telegram_updates.sql',
      '0016_lawyer_review_claim.sql',
      '0017_lawyer_review_admin_role.sql',
    ])
      db.exec(readFileSync(new URL(`../../../cloudflare/d1/${name}`, import.meta.url), 'utf8'));
    count = { queries: 0 };
    repo = new D1LawyerRepository(
      binding(db, count),
      {
        async put() {
          return { key: 'private' };
        },
        async get() {
          return null;
        },
        async delete() {},
      },
      'https://api.example.test',
      'signing-secret-at-least-thirty-two-characters',
      () => NOW,
    );
  });
  afterEach(() => db.close());

  it('hydrates the admin review queue with bounded D1 queries', async () => {
    for (let i = 0; i < 60; i++) {
      db.prepare('INSERT INTO users(id,telegram_user_id,duid) VALUES(?,?,?)').run(
        `u${i}`,
        1000 + i,
        `yr_${String(i).padStart(16, '0')}`,
      );
      db.prepare('INSERT INTO lawyer_profiles(id,user_id,public_slug) VALUES(?,?,?)').run(
        `l${i}`,
        `u${i}`,
        `yr_${String(i).padStart(16, '0')}`,
      );
      db.prepare(
        `INSERT INTO lawyer_verifications(id,lawyer_id,type,status,submitted_data,submitted_at)
        VALUES(?,?,'initial','pending_review','{}',?)`,
      ).run(`v${i}`, `l${i}`, NOW.toISOString());
    }
    count.queries = 0;
    const queue = await repo.listVerifications({ page: 1, limit: 60, status: 'pending_review' });
    expect(queue.total).toBe(60);
    expect(queue.items).toHaveLength(60);
    expect(queue.items[0]?.profile.user.duid).toMatch(/^yr_/);
    expect(count.queries).toBeLessThanOrEqual(6);
    expect((await repo.getVerificationDetail('v0'))?.profile.profile.id).toBe('l0');
    expect(await repo.getVerificationDetail('absent')).toBeNull();
  });

  it('uses the same verified review transaction through the complete adapter', async () => {
    db.prepare(
      "INSERT INTO users(id,telegram_user_id,duid) VALUES('u',42,'yr_abcdefghijklmnop')",
    ).run();
    const profile = await repo.createProfile('u', 'yr_abcdefghijklmnop');
    const admin = await repo.createAdmin('admin', 'hash');
    db.prepare("UPDATE admin_accounts SET role='admin' WHERE id=?").run(admin.id);
    const draft = {
      fullName: 'Huquqshunos',
      region: 'Toshkent',
      experienceYears: 4,
      bio: 'Fuqarolik huquqida tajribali yurist.',
      consultationPrice: 10.25,
      profileImagePath: 'private/avatar.jpg',
      specializationCodes: ['civil'],
    };
    const pending = await repo.createVerification({
      lawyerId: profile.profile.id,
      type: 'initial',
      submittedData: draft,
      status: 'pending_review',
      now: NOW,
    });
    expect(
      await repo.reviewVerification({
        verificationId: pending.id,
        adminId: admin.id,
        decision: 'approved',
        rejectReason: null,
      }),
    ).toBe('reviewed');
    expect(
      (await repo.findApprovedProfileByDuid('yr_abcdefghijklmnop'))?.profile.verification_status,
    ).toBe('approved');
    expect((await repo.getVerificationDetail(pending.id))?.verification.status).toBe('approved');
  });
});
