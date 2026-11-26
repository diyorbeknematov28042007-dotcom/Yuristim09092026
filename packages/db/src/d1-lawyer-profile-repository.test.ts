import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  D1LawyerProfileRepository,
  type D1LawyerProfileBinding,
} from './d1-lawyer-profile-repository.js';

function binding(db: DatabaseSync): D1LawyerProfileBinding {
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
describe('D1 lawyer profile and verification lifecycle', () => {
  let db: DatabaseSync;
  let repo: D1LawyerProfileRepository;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of [
      '0001_core_auth.sql',
      '0002_identifier_guards.sql',
      '0003_lawyer_admin.sql',
    ])
      db.exec(readFileSync(new URL(`../../../cloudflare/d1/${name}`, import.meta.url), 'utf8'));
    db.prepare(
      `INSERT INTO users(id,telegram_user_id,duid,full_name)
      VALUES('u1',42,'yr_abcdefghijklmnop','Yurist Bir'),
            ('u2',43,'yr_abcdefghijklmnox','Yurist Ikki')`,
    ).run();
    repo = new D1LawyerProfileRepository(binding(db));
  });
  afterEach(() => db.close());

  it('idempotently creates a private profile and exposes only approved profiles', async () => {
    const duid = 'yr_abcdefghijklmnop';
    const [first, second] = await Promise.all([
      repo.createProfile('u1', duid),
      repo.createProfile('u1', duid),
    ]);
    expect(first.profile.id).toBe(second.profile.id);
    expect((await repo.findRoutingProfileByUserId('u1'))?.verificationStatus).toBe('unverified');
    expect(await repo.findApprovedProfileByDuid(duid)).toBeNull();
    db.prepare(
      `UPDATE lawyer_profiles SET verification_status='approved',
      consultation_price_minor=1235,rating_average_hundredths=475,region='Toshkent',
      experience_years=8,verified_at='2026-11-26T12:00:00.000Z' WHERE user_id='u1'`,
    ).run();
    db.prepare(
      `INSERT INTO lawyer_specializations(lawyer_id,specialization_id)
      SELECT ?,id FROM specializations WHERE code='civil'`,
    ).run(first.profile.id);
    const record = await repo.findApprovedProfileByDuid(duid);
    expect(record?.profile.consultation_price).toBe(12.35);
    expect(record?.profile.rating_average).toBe(4.75);
    expect(record?.specializations[0]?.code).toBe('civil');
    expect(record?.specializations[0]?.active).toBe(true);
    const result = await repo.searchApproved({
      region: 'Toshkent',
      specialization: 'civil',
      minExperience: 7,
      page: 1,
      limit: 5,
      sort: 'rating',
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.user.id).toBe('u1');
    expect(
      (await repo.searchApproved({ page: 1, limit: 5, sort: 'rating', specialization: 'family' }))
        .total,
    ).toBe(0);
    await expect(repo.createProfile('u2', duid)).rejects.toThrow();
  });

  it('keeps one open draft and preserves its submitted snapshot', async () => {
    const record = await repo.createProfile('u1', 'yr_abcdefghijklmnop');
    const now = new Date('2026-11-26T12:00:00.000Z');
    const draft = await repo.createVerification({
      lawyerId: record.profile.id,
      type: 'initial',
      submittedData: { step: 'full_name' },
      now,
    });
    expect((await repo.findLatestVerification(record.profile.id))?.id).toBe(draft.id);
    expect((await repo.findProfileByUserId('u1'))?.profile.verification_status).toBe('draft');
    await expect(
      repo.createVerification({
        lawyerId: record.profile.id,
        type: 'initial',
        submittedData: {},
        now,
      }),
    ).rejects.toThrow();
    expect((await repo.updateDraft(draft.id, { step: 'region' })).submitted_data).toEqual({
      step: 'region',
    });
    const submitted = await repo.submitDraft(draft.id, { fullName: 'Yurist Bir' }, now);
    expect(submitted?.status).toBe('pending_review');
    expect(submitted?.submitted_data).toEqual({ fullName: 'Yurist Bir' });
    expect(await repo.submitDraft(draft.id, {}, now)).toBeNull();
    await expect(repo.updateDraft(draft.id, {})).rejects.toThrow();
    await repo.cancelDraft(draft.id);
    expect((await repo.findVerificationById(draft.id))?.status).toBe('pending_review');
    expect((await repo.findProfileByUserId('u1'))?.profile.verification_status).toBe(
      'pending_review',
    );
  });

  it('cancels an initial draft and restores an unverified profile', async () => {
    const record = await repo.createProfile('u1', 'yr_abcdefghijklmnop');
    const draft = await repo.createVerification({
      lawyerId: record.profile.id,
      type: 'initial',
      submittedData: {},
      now: new Date(),
    });
    await repo.cancelDraft(draft.id);
    expect(await repo.findOpenVerification(record.profile.id)).toBeNull();
    expect((await repo.findProfileByUserId('u1'))?.profile.verification_status).toBe('unverified');
  });
});
