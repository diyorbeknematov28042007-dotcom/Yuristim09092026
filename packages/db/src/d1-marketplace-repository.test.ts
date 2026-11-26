import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D1MarketplaceRepository, type D1MarketplaceBinding } from './d1-marketplace-repository.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const migrations = [
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
];

function binding(db: DatabaseSync): D1MarketplaceBinding {
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

describe('D1 marketplace repository against SQLite', () => {
  let db: DatabaseSync;
  let repo: D1MarketplaceRepository;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of migrations)
      db.exec(readFileSync(new URL(`../../../cloudflare/d1/${name}`, import.meta.url), 'utf8'));
    for (const [id, telegram, duid, role] of [
      ['owner', 42, 'yr_abcdefghijklmnop', 'user'],
      ['lawyer', 43, 'yr_abcdefghijklmnox', 'lawyer'],
      ['lawyer2', 44, 'yr_abcdefghijklmnoy', 'lawyer'],
    ] as const)
      db.prepare(
        `INSERT INTO users(id,telegram_user_id,duid,full_name,onboarding_role,active_mode,
      created_at) VALUES(?,?,?,'Example Name',?,?,?)`,
      ).run(id, telegram, duid, role, role, NOW.toISOString());
    for (const [user, id] of [
      ['lawyer', 'l1'],
      ['lawyer2', 'l2'],
    ] as const) {
      db.prepare(
        "INSERT INTO lawyer_profiles(id,user_id,public_slug,verification_status) VALUES(?,?,?,'approved')",
      ).run(id, user, user);
      db.prepare(
        `INSERT INTO marketplace_accept_transactions(id,lawyer_id,type,amount,balance_after,
        reference_id,created_at) VALUES(?,?,'bonus',1,1,?,?)`,
      ).run(`grant:${id}`, id, `bonus:${id}`, NOW.toISOString());
    }
    repo = new D1MarketplaceRepository(binding(db));
  });
  afterEach(() => db.close());

  async function createPost(repo: D1MarketplaceRepository) {
    return repo.createPost({
      userId: 'owner',
      specializationCode: 'civil',
      description: 'A meaningful legal request description',
      region: 'Tashkent',
      additionalDetails: null,
      idempotencyKey: 'request:1',
      expiresAt: null,
      now: NOW,
      language: 'uz',
    });
  }

  it('persists a single draft and publishes it with idempotency', async () => {
    await repo.saveDraft({
      user_id: 'owner',
      specialization_code: 'civil',
      description: 'A meaningful legal request description',
      region: 'Tashkent',
      additional_details: null,
      step: 'preview',
      language: 'uz',
    });
    expect((await repo.getDraft('owner'))?.step).toBe('preview');
    const post = await createPost(repo);
    expect(post.status).toBe('open');
    expect(post.specialization_code).toBe('civil');
    expect((await createPost(repo)).id).toBe(post.id);
    expect(await repo.getDraft('owner')).toBeNull();
  });

  it('spends one accept exactly once and enforces capacity', async () => {
    const post = await createPost(repo);
    db.prepare('UPDATE marketplace_posts SET max_acceptances=1 WHERE id=?').run(post.id);
    const first = await repo.acceptPost(post.public_identifier, 'lawyer', NOW);
    expect(first.duplicate).toBe(false);
    expect((await repo.acceptPost(post.public_identifier, 'lawyer', NOW)).duplicate).toBe(true);
    await expect(repo.acceptPost(post.public_identifier, 'lawyer2', NOW)).rejects.toMatchObject({
      databaseCode: 'MARKETPLACE_CAPACITY_FULL',
    });
    expect(
      db
        .prepare(
          "SELECT sum(amount) balance FROM marketplace_accept_transactions WHERE lawyer_id='l2'",
        )
        .get(),
    ).toMatchObject({ balance: 1 });
    const result = await repo.selectLawyer({
      postId: post.id,
      userId: 'owner',
      acceptanceId: first.acceptanceId,
      now: NOW,
    });
    expect(result.duplicate).toBe(false);
    expect(
      (
        await repo.selectLawyer({
          postId: post.id,
          userId: 'owner',
          acceptanceId: first.acceptanceId,
          now: NOW,
        })
      ).duplicate,
    ).toBe(true);
    expect(
      db.prepare("SELECT jobs_count n FROM lawyer_profiles WHERE id='l1'").get(),
    ).toMatchObject({ n: 1 });
    expect(
      (
        await repo.createReview({
          postId: post.id,
          userId: 'owner',
          rating: 5,
          comment: null,
          now: NOW,
        })
      ).rating,
    ).toBe(5);
  });

  it('closes accepted lawyers when the owner cancels', async () => {
    const post = await createPost(repo);
    await repo.acceptPost(post.public_identifier, 'lawyer', NOW);
    expect((await repo.cancelPost(post.id, 'owner', NOW)).status).toBe('cancelled');
    expect(
      db
        .prepare('SELECT status FROM marketplace_acceptances WHERE marketplace_post_id=?')
        .get(post.id),
    ).toMatchObject({ status: 'cancelled' });
  });
});
