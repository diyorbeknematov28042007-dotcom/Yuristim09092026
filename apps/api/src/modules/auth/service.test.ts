import type { PinHasher } from './crypto.js';
import { describe, expect, it } from 'vitest';
import { MemoryCoreRepository } from '../../testing/memory-core-repository.js';
import { CoreAuthService } from './service.js';

const TEST_SECRET = 'test-session-secret-that-is-at-least-32-characters';
const completed = {
  language: 'uz',
  onboarding_role: 'user',
  onboarding_status: 'completed',
  terms_accepted_at: '2026-09-09T10:00:00.000Z',
  terms_version: '2026-09',
} as const;
const identity = {
  telegramFirstName: 'Diyorbek',
  telegramUserId: 123_456_789,
  telegramUsername: 'diyorbek',
};

const testPinHasher: PinHasher = {
  hash: (pin) => Promise.resolve(`test-hash:${pin}`),
  verify: (digest, pin) => Promise.resolve(digest === `test-hash:${pin}`),
};

function createFixture() {
  let currentTime = new Date('2026-09-09T10:00:00.000Z');
  const repository = new MemoryCoreRepository();
  const service = new CoreAuthService(repository, {
    challengeTtlSeconds: 600,
    now: () => currentTime,
    pinHasher: testPinHasher,
    sessionSecret: TEST_SECRET,
    sessionTtlSeconds: 3_600,
  });
  return {
    advance(milliseconds: number) {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    repository,
    service,
  };
}

describe('CoreAuthService users and DUID', () => {
  it('concurrent client identity resolution creates one account and DUID', async () => {
    const { repository, service } = createFixture();
    const results = await Promise.all(
      Array.from({ length: 3 }, () => service.ensureTelegramUser(identity)),
    );
    expect(new Set(results.map((result) => result.user.id)).size).toBe(1);
    expect(new Set(results.map((result) => result.user.duid)).size).toBe(1);
    expect(repository.users.size).toBe(1);
  });
  it('creates one account per Telegram ID and updates mutable Telegram metadata', async () => {
    const { repository, service } = createFixture();
    const first = await service.ensureTelegramUser(identity);
    const second = await service.ensureTelegramUser({
      ...identity,
      telegramFirstName: 'Diyorbekjon',
      telegramUsername: 'new_username',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.telegram_username).toBe('new_username');
    expect(second.user.telegram_first_name).toBe('Diyorbekjon');
    expect(repository.users).toHaveLength(1);
  });

  it('retries a DUID collision without changing Telegram identity', async () => {
    const repository = new MemoryCoreRepository();
    repository.seedUser({ ...completed, duid: 'yr_AAAAAAAAAAAAAAAA' });
    const values = ['yr_AAAAAAAAAAAAAAAA', 'yr_BBBBBBBBBBBBBBBB'];
    const service = new CoreAuthService(repository, {
      challengeTtlSeconds: 600,
      duidGenerator: { generate: () => values.shift() ?? 'yr_CCCCCCCCCCCCCCCC' },
      pinHasher: testPinHasher,
      sessionSecret: TEST_SECRET,
      sessionTtlSeconds: 3_600,
    });

    const result = await service.ensureTelegramUser(identity);
    expect(result.user.duid).toBe('yr_BBBBBBBBBBBBBBBB');
    expect(result.user.telegram_user_id).toBe(identity.telegramUserId);
  });
});

describe('CoreAuthService Telegram login', () => {
  it('keeps registration pending until explicit Bot onboarding completes, preserving one DUID across clients', async () => {
    const { repository, service } = createFixture();
    const login = await service.startTelegramLogin();
    await service.confirmTelegramLogin(login.challenge, identity);
    const original = [...repository.users.values()][0]!;
    expect((await service.getTelegramLoginStatus(login.requestId)).status).toBe('pending');
    await expect(
      service.consumeTelegramLogin(login.requestId, login.challenge),
    ).rejects.toMatchObject({ code: 'ONBOARDING_REQUIRED' });
    await expect(service.loginTelegramMiniApp(identity)).rejects.toMatchObject({
      code: 'ONBOARDING_REQUIRED',
    });
    expect(repository.sessions.size).toBe(0);
    expect(repository.loginRequests.get(login.requestId)?.status).toBe('confirmed');
    await service.updateTelegramOnboarding(identity.telegramUserId, {
      action: 'set_language',
      language: 'uz',
    });
    await service.updateTelegramOnboarding(identity.telegramUserId, {
      action: 'set_role',
      role: 'user',
    });
    expect((await service.getTelegramLoginStatus(login.requestId)).status).toBe('pending');
    await service.updateTelegramOnboarding(identity.telegramUserId, {
      action: 'accept_terms',
      termsVersion: '2026-09',
    });
    expect((await service.getTelegramLoginStatus(login.requestId)).status).toBe('confirmed');
    const web = await service.consumeTelegramLogin(login.requestId, login.challenge);
    const miniapp = await service.loginTelegramMiniApp(identity);
    const bot = await service.getTelegramUserContext(identity.telegramUserId);
    expect(web.user.id).toBe(original.id);
    expect(miniapp.user.id).toBe(original.id);
    expect(bot.user.id).toBe(original.id);
    expect(web.user.duid).toBe(original.duid);
    expect(miniapp.user.duid).toBe(original.duid);
    expect(bot.user.duid).toBe(original.duid);
    expect(repository.users.size).toBe(1);
  });

  it('denies blocked accounts through every auth path, including repeated confirmation and existing sessions', async () => {
    const { repository, service } = createFixture();
    const user = repository.seedUser({
      ...completed,
      telegram_user_id: identity.telegramUserId,
      pin_hash: 'test-hash:0001',
    });
    const issued = await service.loginTelegramMiniApp(identity);
    const login = await service.startTelegramLogin();
    await service.confirmTelegramLogin(login.challenge, identity);
    await repository.updateUser(user.id, { status: 'blocked' });
    for (const operation of [
      () => service.loginTelegramMiniApp(identity),
      () => service.verifyPin(user.duid, '0001'),
      () => service.confirmTelegramLogin(login.challenge, identity),
      () => service.consumeTelegramLogin(login.requestId, login.challenge),
      () => service.resetPin(login.requestId, login.challenge, '4821'),
      () => service.getTelegramLoginStatus(login.requestId),
      () => service.authenticate(issued.rawToken),
    ])
      await expect(operation()).rejects.toMatchObject({ code: 'USER_BLOCKED' });
    expect(repository.sessions.size).toBe(1);
  });

  it('does not issue a session before Bot confirmation or after expiration', async () => {
    const { advance, repository, service } = createFixture();
    repository.seedUser({ ...completed, telegram_user_id: identity.telegramUserId });
    const login = await service.startTelegramLogin();
    await expect(
      service.consumeTelegramLogin(login.requestId, login.challenge),
    ).rejects.toMatchObject({ code: 'INVALID_LOGIN_CHALLENGE' });
    await service.confirmTelegramLogin(login.challenge, identity);
    advance(601_000);
    expect((await service.getTelegramLoginStatus(login.requestId)).status).toBe('expired');
    await expect(
      service.consumeTelegramLogin(login.requestId, login.challenge),
    ).rejects.toMatchObject({ code: 'LOGIN_CHALLENGE_EXPIRED' });
    expect(repository.sessions.size).toBe(0);
  });

  it('creates, confirms idempotently, and consumes a challenge once', async () => {
    const { repository, service } = createFixture();
    repository.seedUser({ ...completed, telegram_user_id: identity.telegramUserId });
    const login = await service.startTelegramLogin();

    expect(repository.loginRequests.get(login.requestId)?.challenge_hash).not.toBe(login.challenge);
    await expect(service.confirmTelegramLogin(login.challenge, identity)).resolves.toEqual({
      requestId: login.requestId,
      status: 'confirmed',
    });
    await expect(service.confirmTelegramLogin(login.challenge, identity)).resolves.toEqual({
      requestId: login.requestId,
      status: 'confirmed',
    });

    const issued = await service.consumeTelegramLogin(login.requestId, login.challenge);
    expect(issued.rawToken).toBeTruthy();
    expect(repository.sessions.get(issued.session.id)?.token_hash).not.toBe(issued.rawToken);
    await expect(
      service.consumeTelegramLogin(login.requestId, login.challenge),
    ).rejects.toMatchObject({
      code: 'INVALID_LOGIN_CHALLENGE',
    });
  });

  it('rejects wrong and expired challenges', async () => {
    const { advance, service } = createFixture();
    const login = await service.startTelegramLogin();

    await expect(
      service.confirmTelegramLogin('wrong-challenge-that-is-long-enough', identity),
    ).rejects.toMatchObject({ code: 'INVALID_LOGIN_CHALLENGE' });

    advance(601_000);
    await expect(service.confirmTelegramLogin(login.challenge, identity)).rejects.toMatchObject({
      code: 'LOGIN_CHALLENGE_EXPIRED',
    });
  });
});

describe('CoreAuthService PIN and sessions', () => {
  it('an existing session cannot bypass onboarding reset; the original DUID is retained', async () => {
    const { repository, service } = createFixture();
    const user = repository.seedUser({ ...completed, telegram_user_id: identity.telegramUserId });
    const session = await service.loginTelegramMiniApp(identity);
    await service.updateTelegramOnboarding(identity.telegramUserId, { action: 'reset' });
    await expect(service.authenticate(session.rawToken)).rejects.toMatchObject({
      code: 'ONBOARDING_REQUIRED',
    });
    const context = await service.getTelegramUserContext(identity.telegramUserId);
    expect(context.user.id).toBe(user.id);
    expect(context.user.duid).toBe(user.duid);
  });
  it('verifies a correct PIN and stores only a session token hash', async () => {
    const { repository, service } = createFixture();
    const user = repository.seedUser({
      ...completed,
      duid: 'yr_DDDDDDDDDDDDDDDD',
      pin_hash: 'test-hash:0001',
    });

    const issued = await service.verifyPin(user.duid, '0001');
    expect(issued.user.id).toBe(user.id);
    expect(issued.session.token_hash).not.toBe(issued.rawToken);
    expect(
      [...repository.sessions.values()].some((session) => session.token_hash === issued.rawToken),
    ).toBe(false);
  });

  it('locks PIN verification temporarily after five failures', async () => {
    const { repository, service } = createFixture();
    const user = repository.seedUser({
      ...completed,
      duid: 'yr_EEEEEEEEEEEEEEEE',
      pin_hash: 'test-hash:0001',
    });

    for (let attempt = 1; attempt < 5; attempt += 1) {
      await expect(service.verifyPin(user.duid, '9999')).rejects.toMatchObject({
        code: 'INVALID_PIN',
      });
    }
    await expect(service.verifyPin(user.duid, '9999')).rejects.toMatchObject({
      code: 'PIN_TEMPORARILY_LOCKED',
    });
    await expect(service.verifyPin(user.duid, '0001')).rejects.toMatchObject({
      code: 'PIN_TEMPORARILY_LOCKED',
    });
  });

  it('expires and revokes server-controlled sessions', async () => {
    const { advance, repository, service } = createFixture();
    const user = repository.seedUser({
      ...completed,
      duid: 'yr_FFFFFFFFFFFFFFFF',
      pin_hash: 'test-hash:4821',
    });
    const first = await service.verifyPin(user.duid, '4821');
    await service.logout(first.session.id);
    await expect(service.authenticate(first.rawToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    const second = await service.verifyPin(user.duid, '4821');
    advance(3_601_000);
    await expect(service.authenticate(second.rawToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
