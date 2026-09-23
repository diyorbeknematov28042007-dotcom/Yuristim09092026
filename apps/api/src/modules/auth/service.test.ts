import type { PinHasher } from './crypto.js';
import { describe, expect, it } from 'vitest';
import { MemoryCoreRepository } from '../../testing/memory-core-repository.js';
import { CoreAuthService } from './service.js';

const TEST_SECRET = 'test-session-secret-that-is-at-least-32-characters';
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
    repository.seedUser({ duid: 'yr_AAAAAAAAAAAAAAAA' });
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
  it('creates, confirms idempotently, and consumes a challenge once', async () => {
    const { repository, service } = createFixture();
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
  it('verifies a correct PIN and stores only a session token hash', async () => {
    const { repository, service } = createFixture();
    const user = repository.seedUser({ duid: 'yr_DDDDDDDDDDDDDDDD', pin_hash: 'test-hash:0001' });

    const issued = await service.verifyPin(user.duid, '0001');
    expect(issued.user.id).toBe(user.id);
    expect(issued.session.token_hash).not.toBe(issued.rawToken);
    expect(
      [...repository.sessions.values()].some((session) => session.token_hash === issued.rawToken),
    ).toBe(false);
  });

  it('locks PIN verification temporarily after five failures', async () => {
    const { repository, service } = createFixture();
    const user = repository.seedUser({ duid: 'yr_EEEEEEEEEEEEEEEE', pin_hash: 'test-hash:0001' });

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
    const user = repository.seedUser({ duid: 'yr_FFFFFFFFFFFFFFFF', pin_hash: 'test-hash:4821' });
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
