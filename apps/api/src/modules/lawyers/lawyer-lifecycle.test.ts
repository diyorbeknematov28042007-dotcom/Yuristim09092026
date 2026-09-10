import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { AdminService } from '../admin/service.js';
import type { PinHasher } from '../auth/crypto.js';
import { CoreAuthService } from '../auth/service.js';
import { MemoryCoreRepository } from '../../testing/memory-core-repository.js';
import { MemoryLawyerRepository } from '../../testing/memory-lawyer-repository.js';
import { LawyerService } from './service.js';

const pinHasher: PinHasher = {
  hash: (pin) => Promise.resolve(`hash:${pin}`),
  verify: (digest, pin) => Promise.resolve(digest === `hash:${pin}`),
};
const complete = {
  bio: 'Fuqarolik va oila huquqi bo‘yicha professional yurist.',
  consultationPrice: 250_000,
  experienceYears: 7,
  fullName: 'Ne’matov Diyorbek Dilshidjon o‘g‘li',
  region: 'Toshkent shahri',
  specializationCodes: ['civil', 'family'],
};
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
const pdf = Buffer.from('%PDF-1.4 test').toString('base64');

describe('lawyer verification lifecycle API', () => {
  let app: FastifyInstance;
  let core: MemoryCoreRepository;
  let lawyers: MemoryLawyerRepository;
  let cookie: string;
  let adminCookie: string;
  let userDuid: string;

  beforeEach(async () => {
    core = new MemoryCoreRepository();
    const user = core.seedUser({
      full_name: complete.fullName,
      language: 'uz',
      onboarding_role: 'lawyer',
      onboarding_status: 'completed',
      pin_hash: 'hash:0001',
      terms_accepted_at: new Date().toISOString(),
    });
    userDuid = user.duid;
    lawyers = new MemoryLawyerRepository(core);
    const auth = new CoreAuthService(core, {
      challengeTtlSeconds: 600,
      pinHasher,
      sessionSecret: 'session-secret-at-least-thirty-two-characters',
      sessionTtlSeconds: 3600,
    });
    const lawyerService = new LawyerService(lawyers);
    const admin = new AdminService(lawyers, {
      sessionSecret: 'session-secret-at-least-thirty-two-characters',
      sessionTtlSeconds: 3600,
    });
    await admin.bootstrap('phase4admin', 'very-secure-phase4-password');
    app = buildApp({
      core: {
        adminService: admin,
        internalBotSecret: 'internal-secret-at-least-thirty-two-characters',
        lawyerService,
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
    cookie = String(login.headers['set-cookie']).split(';', 1)[0]!;
    const adminLogin = await app.inject({
      method: 'POST',
      payload: { password: 'very-secure-phase4-password', username: 'phase4admin' },
      url: '/admin/auth/login',
    });
    adminCookie = String(adminLogin.headers['set-cookie']).split(';', 1)[0]!;
  });

  afterEach(async () => app.close());

  async function createPending(): Promise<string> {
    await app.inject({ headers: { cookie }, method: 'POST', payload: {}, url: '/lawyers/apply' });
    await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { type: 'initial' },
      url: '/lawyers/me/verifications/draft',
    });
    const image = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: {
        base64: jpg,
        contentType: 'image/jpeg',
        kind: 'profile_image',
        originalFilename: 'avatar.jpg',
      },
      url: '/lawyers/me/verifications/files',
    });
    const document = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: {
        base64: pdf,
        contentType: 'application/pdf',
        kind: 'verification_document',
        originalFilename: 'license.pdf',
      },
      url: '/lawyers/me/verifications/files',
    });
    const submitted = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: {
        ...complete,
        profileImagePath: image.json<{ path: string }>().path,
        verificationDocumentPaths: [document.json<{ path: string }>().path],
      },
      url: '/lawyers/me/verifications',
    });
    expect(submitted.statusCode).toBe(201);
    return submitted.json<{ verification: { id: string } }>().verification.id;
  }

  it('applies idempotently, localizes specializations, and hides unverified profiles', async () => {
    expect(
      (await app.inject({ method: 'POST', payload: {}, url: '/lawyers/apply' })).statusCode,
    ).toBe(401);
    const first = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: {},
      url: '/lawyers/apply',
    });
    const second = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: {},
      url: '/lawyers/apply',
    });
    expect(first.json()).toMatchObject({
      profile: { publicSlug: userDuid, verificationStatus: 'unverified' },
    });
    expect(second.json()).toMatchObject({
      profile: { id: first.json<{ profile: { id: string } }>().profile.id },
    });
    expect(lawyers.profiles).toHaveLength(1);
    const specializations = await app.inject({
      method: 'GET',
      url: '/specializations?language=ru',
    });
    expect(
      specializations.json<{ specializations: Array<{ name: string }> }>().specializations[0]?.name,
    ).toContain('право');
    expect((await app.inject({ method: 'GET', url: `/lawyers/${userDuid}` })).statusCode).toBe(404);
  });

  it('submits once, approves atomically, exposes public search, and unlocks lawyer mode', async () => {
    const verificationId = await createPending();
    const duplicate = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { ...complete, profileImagePath: 'wrong', verificationDocumentPaths: ['wrong'] },
      url: '/lawyers/me/verifications',
    });
    expect(duplicate.statusCode).toBe(409);
    const list = await app.inject({
      headers: { cookie: adminCookie },
      method: 'GET',
      url: '/admin/lawyer-verifications?status=pending_review',
    });
    expect(list.json()).toMatchObject({ total: 1 });
    const approved = await app.inject({
      headers: { cookie: adminCookie },
      method: 'POST',
      payload: {},
      url: `/admin/lawyer-verifications/${verificationId}/approve`,
    });
    expect(approved.statusCode).toBe(204);
    expect(lawyers.auditLogs).toContainEqual({
      action: 'lawyer_verification.approved',
      entityId: verificationId,
    });
    const secondReview = await app.inject({
      headers: { cookie: adminCookie },
      method: 'POST',
      payload: {},
      url: `/admin/lawyer-verifications/${verificationId}/approve`,
    });
    expect(secondReview.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `/lawyers/${userDuid}` })).json()).toMatchObject(
      { profile: { fullName: complete.fullName, verificationStatus: 'approved' } },
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/lawyers?specialization=civil&min_experience=5&sort=rating&page=1&limit=10',
        })
      ).json(),
    ).toMatchObject({ total: 1 });
    expect(
      (
        await app.inject({
          headers: { cookie },
          method: 'POST',
          payload: { mode: 'lawyer' },
          url: '/users/me/mode',
        })
      ).json(),
    ).toMatchObject({ user: { activeMode: 'lawyer' } });
  });

  it('requires a reject reason, preserves history, and supports resubmission', async () => {
    const verificationId = await createPending();
    expect(
      (
        await app.inject({
          headers: { cookie: adminCookie },
          method: 'POST',
          payload: {},
          url: `/admin/lawyer-verifications/${verificationId}/reject`,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          headers: { cookie: adminCookie },
          method: 'POST',
          payload: { reason: 'Hujjat sifati yetarli emas' },
          url: `/admin/lawyer-verifications/${verificationId}/reject`,
        })
      ).statusCode,
    ).toBe(204);
    const status = await app.inject({
      headers: { cookie },
      method: 'GET',
      url: '/lawyers/me/verification',
    });
    expect(status.json()).toMatchObject({
      verification: { rejectReason: 'Hujjat sifati yetarli emas', status: 'rejected' },
    });
    const resubmit = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { type: 'initial' },
      url: '/lawyers/me/verifications/draft',
    });
    expect(resubmit.statusCode).toBe(201);
    expect(lawyers.verifications).toHaveLength(2);
  });

  it('keeps the approved public profile unchanged until profile-update approval', async () => {
    const initialId = await createPending();
    expect(
      (
        await app.inject({
          headers: { cookie: adminCookie },
          method: 'POST',
          payload: {},
          url: `/admin/lawyer-verifications/${initialId}/approve`,
        })
      ).statusCode,
    ).toBe(204);

    const draft = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { type: 'profile_update' },
      url: '/lawyers/me/verifications/draft',
    });
    expect(draft.statusCode).toBe(201);
    await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: {
        base64: jpg,
        contentType: 'image/jpeg',
        kind: 'profile_image',
        originalFilename: 'updated-avatar.jpg',
      },
      url: '/lawyers/me/verifications/files',
    });
    await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: {
        base64: pdf,
        contentType: 'application/pdf',
        kind: 'verification_document',
        originalFilename: 'updated-license.pdf',
      },
      url: '/lawyers/me/verifications/files',
    });
    const change = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: {
        bio: 'Samarqanddagi yangilangan professional yuridik amaliyot haqida ma’lumot.',
        region: 'Samarqand viloyati',
      },
      url: '/lawyers/me/profile-change',
    });
    expect(change.statusCode).toBe(201);
    const changeId = change.json<{ verification: { id: string } }>().verification.id;
    expect((await app.inject({ method: 'GET', url: `/lawyers/${userDuid}` })).json()).toMatchObject(
      { profile: { region: complete.region } },
    );

    expect(
      (
        await app.inject({
          headers: { cookie: adminCookie },
          method: 'POST',
          payload: {},
          url: `/admin/lawyer-verifications/${changeId}/approve`,
        })
      ).statusCode,
    ).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/lawyers/${userDuid}` })).json()).toMatchObject(
      { profile: { region: 'Samarqand viloyati' } },
    );
  });

  it('logs admin failures and keeps raw admin session tokens out of storage', async () => {
    const wrong = await app.inject({
      method: 'POST',
      payload: { password: 'wrong-password', username: 'phase4admin' },
      url: '/admin/auth/login',
    });
    expect(wrong.statusCode).toBe(401);
    expect(lawyers.loginLogs.some((entry) => !entry.success)).toBe(true);
    expect(
      [...lawyers.adminSessions.values()].every(
        (session) => !adminCookie.includes(session.token_hash),
      ),
    ).toBe(true);
    expect(
      (
        await app.inject({
          headers: { cookie: adminCookie },
          method: 'GET',
          url: '/admin/auth/session',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('locks repeated admin password failures and validates public search filters', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        payload: { password: 'wrong-password', username: 'phase4admin' },
        url: '/admin/auth/login',
      });
      expect(response.statusCode).toBe(401);
    }
    const locked = await app.inject({
      method: 'POST',
      payload: { password: 'very-secure-phase4-password', username: 'phase4admin' },
      url: '/admin/auth/login',
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: { code: 'PIN_TEMPORARILY_LOCKED' } });
    expect((await app.inject({ method: 'GET', url: '/lawyers?limit=51' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/lawyers?sort=unsafe' })).statusCode).toBe(400);
  });
});
