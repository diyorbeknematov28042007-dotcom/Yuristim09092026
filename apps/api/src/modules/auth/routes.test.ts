import { randomUUID } from 'node:crypto';
import type { PinHasher } from './crypto.js';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { MemoryCoreRepository } from '../../testing/memory-core-repository.js';
import { signInternalRequest } from './internal-auth.js';
import { CoreAuthService } from './service.js';

const INTERNAL_SECRET = 'test-internal-secret-that-is-at-least-32-characters';
const SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters';
const pinHasher: PinHasher = {
  hash: (pin) => Promise.resolve(`test-hash:${pin}`),
  verify: (digest, pin) => Promise.resolve(digest === `test-hash:${pin}`),
};
const identity = {
  telegramFirstName: 'Diyorbek',
  telegramUserId: 280_420_070,
  telegramUsername: 'diyorbek',
};

describe('core auth and user API', () => {
  let app: FastifyInstance;
  let repository: MemoryCoreRepository;
  let service: CoreAuthService;

  beforeEach(() => {
    repository = new MemoryCoreRepository();
    service = new CoreAuthService(repository, {
      challengeTtlSeconds: 600,
      pinHasher,
      sessionSecret: SESSION_SECRET,
      sessionTtlSeconds: 3_600,
    });
    app = buildApp({
      core: { internalBotSecret: INTERNAL_SECRET, production: false, service },
      logger: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  function internalHeaders(body: unknown): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1_000));
    return {
      'x-yuristim-signature': signInternalRequest(body, timestamp, INTERNAL_SECRET),
      'x-yuristim-timestamp': timestamp,
    };
  }

  async function createSessionCookie(): Promise<string> {
    const started = await app.inject({ method: 'POST', url: '/auth/telegram/start' });
    const login = started.json<{ challenge: string; requestId: string }>();
    const confirmBody = { challenge: login.challenge, identity };
    const internalConfirmation = await app.inject({
      headers: internalHeaders(confirmBody),
      method: 'POST',
      payload: confirmBody,
      url: '/internal/telegram/auth/confirm',
    });
    expect(internalConfirmation.statusCode).toBe(200);

    const confirmed = await app.inject({
      method: 'POST',
      payload: { challenge: login.challenge, requestId: login.requestId },
      url: '/auth/telegram/confirm',
    });
    expect(confirmed.statusCode).toBe(200);
    const setCookie = confirmed.headers['set-cookie'];
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    return String(setCookie).split(';', 1)[0]!;
  }

  it('returns the structured 401 format for unauthorized user access', async () => {
    const response = await app.inject({ method: 'GET', url: '/users/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
      requestId: expect.any(String),
    });
  });

  it('protects internal endpoints with HMAC and ensures a Telegram user idempotently', async () => {
    const rejected = await app.inject({
      method: 'POST',
      payload: identity,
      url: '/internal/telegram/users/ensure',
    });
    expect(rejected.statusCode).toBe(401);

    const created = await app.inject({
      headers: internalHeaders(identity),
      method: 'POST',
      payload: identity,
      url: '/internal/telegram/users/ensure',
    });
    expect(created.statusCode).toBe(201);

    const changedIdentity = { ...identity, telegramUsername: 'updated_username' };
    const updated = await app.inject({
      headers: internalHeaders(changedIdentity),
      method: 'POST',
      payload: changedIdentity,
      url: '/internal/telegram/users/ensure',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      created: false,
      user: { telegramUsername: 'updated_username' },
    });
    expect(repository.users.size).toBe(1);
  });

  it('completes Telegram confirmation and returns an authorized session', async () => {
    const cookie = await createSessionCookie();
    const session = await app.inject({ headers: { cookie }, method: 'GET', url: '/auth/session' });
    const me = await app.inject({ headers: { cookie }, method: 'GET', url: '/users/me' });

    expect(session.statusCode).toBe(200);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { telegramUserId: String(identity.telegramUserId) } });
    expect(JSON.stringify(me.json())).not.toContain('pin_hash');
    expect(JSON.stringify(me.json())).not.toContain('token_hash');
  });

  it('resets a four-digit PIN through a one-time Telegram challenge', async () => {
    const invalidPin = await app.inject({
      method: 'POST',
      payload: { duid: 'yr_abcdefghijklmnop', pin: '123' },
      url: '/auth/pin/verify',
    });
    expect(invalidPin.statusCode).toBe(400);

    const started = await app.inject({ method: 'POST', url: '/auth/telegram/start' });
    const login = started.json<{ challenge: string; requestId: string }>();
    const confirmationBody = { challenge: login.challenge, identity };
    await app.inject({
      headers: internalHeaders(confirmationBody),
      method: 'POST',
      payload: confirmationBody,
      url: '/internal/telegram/auth/confirm',
    });

    const reset = await app.inject({
      method: 'POST',
      payload: { challenge: login.challenge, newPin: '0001', requestId: login.requestId },
      url: '/auth/pin/reset',
    });
    expect(reset.statusCode).toBe(200);
    const user = [...repository.users.values()][0]!;
    expect(user.pin_hash).toBe('test-hash:0001');
    expect(JSON.stringify(user)).not.toContain('"0001"');

    const verified = await app.inject({
      method: 'POST',
      payload: { duid: user.duid, pin: '0001' },
      url: '/auth/pin/verify',
    });
    expect(verified.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      payload: { challenge: login.challenge, newPin: '4821', requestId: login.requestId },
      url: '/auth/pin/reset',
    });
    expect(replay.statusCode).toBe(400);
  });

  it('rejects invalid language and protected-field mass assignment', async () => {
    const cookie = await createSessionCookie();
    const invalidLanguage = await app.inject({
      headers: { cookie },
      method: 'PATCH',
      payload: { language: 'de' },
      url: '/users/me/language',
    });
    const protectedUpdate = await app.inject({
      headers: { cookie },
      method: 'PATCH',
      payload: { fullName: 'Diyorbek Nematov', status: 'blocked' },
      url: '/users/me',
    });

    expect(invalidLanguage.statusCode).toBe(400);
    expect(invalidLanguage.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(protectedUpdate.statusCode).toBe(400);
    expect(repository.users.values().next().value?.status).toBe('active');
  });

  it('updates language, profile, terms, and user role through allowlisted fields', async () => {
    const cookie = await createSessionCookie();
    await app.inject({
      headers: { cookie },
      method: 'PATCH',
      payload: { fullName: 'Diyorbek Nematov' },
      url: '/users/me',
    });
    const language = await app.inject({
      headers: { cookie },
      method: 'PATCH',
      payload: { language: 'uz' },
      url: '/users/me/language',
    });
    const terms = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { version: '2026-09' },
      url: '/users/me/accept-terms',
    });
    const role = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { role: 'user' },
      url: '/users/me/role',
    });

    expect(language.json()).toMatchObject({ user: { language: 'uz' } });
    expect(terms.json()).toMatchObject({ user: { termsVersion: '2026-09' } });
    expect(role.json()).toMatchObject({
      user: { activeMode: 'user', onboardingRole: 'user', onboardingStatus: 'active' },
    });
  });

  it('requires a full name for lawyer intention and rejects unverified lawyer mode', async () => {
    const cookie = await createSessionCookie();
    const missingName = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { role: 'lawyer' },
      url: '/users/me/role',
    });
    expect(missingName.statusCode).toBe(400);

    await app.inject({
      headers: { cookie },
      method: 'PATCH',
      payload: { fullName: 'Diyorbek Nematov' },
      url: '/users/me',
    });
    const intention = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { role: 'lawyer' },
      url: '/users/me/role',
    });
    const mode = await app.inject({
      headers: { cookie },
      method: 'POST',
      payload: { mode: 'lawyer' },
      url: '/users/me/mode',
    });

    expect(intention.json()).toMatchObject({
      user: { activeMode: 'user', onboardingRole: 'lawyer' },
    });
    expect(mode.statusCode).toBe(409);
    expect(mode.json()).toMatchObject({ error: { code: 'LAWYER_NOT_VERIFIED' } });
  });

  it('returns only active server-managed tags', async () => {
    const cookie = await createSessionCookie();
    const user = [...repository.users.values()][0]!;
    repository.tags.set('active-tag', {
      created_at: new Date().toISOString(),
      expires_at: null,
      id: randomUUID(),
      metadata: { source: 'test' },
      tag: 'student',
      user_id: user.id,
    });
    repository.tags.set('expired-tag', {
      created_at: new Date().toISOString(),
      expires_at: '2020-01-01T00:00:00.000Z',
      id: randomUUID(),
      metadata: {},
      tag: 'expired',
      user_id: user.id,
    });

    const response = await app.inject({
      headers: { cookie },
      method: 'GET',
      url: '/users/me/tags',
    });
    expect(response.json()).toMatchObject({ tags: [{ tag: 'student' }] });
  });

  it('revokes logout sessions and rejects blocked users', async () => {
    const cookie = await createSessionCookie();
    const logout = await app.inject({ headers: { cookie }, method: 'POST', url: '/auth/logout' });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers['set-cookie']).toContain('yuristim_session=;');
    expect(
      (await app.inject({ headers: { cookie }, method: 'GET', url: '/users/me' })).statusCode,
    ).toBe(401);

    const blockedUser = repository.seedUser({
      duid: 'yr_ZZZZZZZZZZZZZZZZ',
      pin_hash: 'test-hash:4821',
      status: 'blocked',
    });
    const blocked = await app.inject({
      method: 'POST',
      payload: { duid: blockedUser.duid, pin: '4821' },
      url: '/auth/pin/verify',
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: { code: 'USER_BLOCKED' } });
  });
});
