import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  D1LawyerReviewRepository,
  type D1LawyerReviewBinding,
} from './d1-lawyer-review-repository.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
function binding(db: DatabaseSync): D1LawyerReviewBinding {
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
const submitted = {
  fullName: 'Tasdiqlangan huquqshunos',
  region: 'Toshkent',
  experienceYears: 7,
  bio: 'Yuridik tajriba va fuqarolik huquqi bo‘yicha batafsil malaka.',
  consultationPrice: 12.345,
  profileImagePath: 'private/profile.png',
  specializationCodes: ['civil', 'family'],
};
describe('D1 lawyer review atomicity', () => {
  let db: DatabaseSync;
  let repo: D1LawyerReviewRepository;
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
    db.prepare(
      "INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES('u',42,'yr_abcdefghijklmnop',?)",
    ).run(NOW.toISOString());
    db.prepare(
      "INSERT INTO admin_accounts(id,username,password_hash) VALUES('a','admin','hash')",
    ).run();
    db.prepare(
      "INSERT INTO lawyer_profiles(id,user_id,public_slug) VALUES('l','u','lawyer')",
    ).run();
    db.prepare(
      "INSERT INTO lawyer_verifications(id,lawyer_id,type,status,submitted_data,submitted_at) VALUES('v','l','initial','pending_review',?,?)",
    ).run(JSON.stringify(submitted), NOW.toISOString());
    repo = new D1LawyerReviewRepository(binding(db), () => NOW);
  });
  afterEach(() => db.close());
  const input = {
    verificationId: 'v',
    adminId: 'a',
    decision: 'approved' as const,
    rejectReason: null,
  };

  it('reviews once, transfers the profile and records exactly one audit event', async () => {
    const attempts = await Promise.all([
      repo.reviewVerification(input),
      repo.reviewVerification(input),
    ]);
    expect(attempts.sort()).toEqual(['conflict', 'reviewed']);
    expect(
      db
        .prepare(
          "SELECT verification_status,consultation_price_minor FROM lawyer_profiles WHERE id='l'",
        )
        .get(),
    ).toEqual({ verification_status: 'approved', consultation_price_minor: 1235 });
    expect(db.prepare("SELECT full_name,onboarding_role FROM users WHERE id='u'").get()).toEqual({
      full_name: submitted.fullName,
      onboarding_role: 'lawyer',
    });
    expect(
      db.prepare("SELECT count(*) total FROM lawyer_specializations WHERE lawyer_id='l'").get(),
    ).toEqual({ total: 2 });
    expect(db.prepare("SELECT count(*) total FROM audit_logs WHERE entity_id='v'").get()).toEqual({
      total: 1,
    });
    expect(() =>
      db
        .prepare(
          "UPDATE lawyer_verifications SET status='rejected',reject_reason='missing' WHERE id='v'",
        )
        .run(),
    ).toThrow();
  });
  it('rolls back every write if the audit insert fails', async () => {
    db.exec(
      "CREATE TRIGGER fail_review_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
    await expect(repo.reviewVerification(input)).rejects.toThrow('audit unavailable');
    expect(db.prepare("SELECT status FROM lawyer_verifications WHERE id='v'").get()).toEqual({
      status: 'pending_review',
    });
    expect(
      db.prepare("SELECT verification_status FROM lawyer_profiles WHERE id='l'").get(),
    ).toEqual({ verification_status: 'pending_review' });
  });
  it('rejects invalid specialization and unauthorized admin before writing', async () => {
    db.prepare("DELETE FROM lawyer_verifications WHERE id='v'").run();
    db.prepare(
      "INSERT INTO lawyer_verifications(id,lawyer_id,type,status,submitted_data,submitted_at) VALUES('v','l','initial','pending_review',?,?)",
    ).run(JSON.stringify({ ...submitted, specializationCodes: ['not_a_code'] }), NOW.toISOString());
    await expect(repo.reviewVerification(input)).rejects.toMatchObject({ databaseCode: '22023' });
    await expect(repo.reviewVerification({ ...input, adminId: 'absent' })).rejects.toThrow(
      'Admin access denied',
    );
    expect(db.prepare("SELECT status FROM lawyer_verifications WHERE id='v'").get()).toEqual({
      status: 'pending_review',
    });
  });
  it('does not let a support account review a lawyer', async () => {
    db.prepare("UPDATE admin_accounts SET role='support' WHERE id='a'").run();
    await expect(repo.reviewVerification(input)).rejects.toThrow('Admin access denied');
    expect(() =>
      db
        .prepare(
          `UPDATE lawyer_verifications SET status='approved',reviewed_by='a',
        reviewed_at=?,review_claim_id=? WHERE id='v'`,
        )
        .run(NOW.toISOString(), crypto.randomUUID()),
    ).toThrow('invalid lawyer review transition');
    expect(db.prepare("SELECT status FROM lawyer_verifications WHERE id='v'").get()).toEqual({
      status: 'pending_review',
    });
  });
});
