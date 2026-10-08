import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { MemoryCoreRepository } from '../../testing/memory-core-repository.js';
import { CoreAuthService } from './service.js';

const token = '123456:telegram-test-token';
const identity = { id: 280420070, first_name: 'Diyorbek', username: 'diyorbek' };

function signedData(user: object, authDate = Math.floor(Date.now() / 1000)) {
  const fields = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AA_TEST',
    user: JSON.stringify(user),
  });
  const data = [...fields.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([a, b]) => `${a}=${b}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  fields.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return fields.toString();
}

describe('Telegram Mini App unified identity', () => {
  it('validates signature, reuses the Bot account and revokes logout session', async () => {
    const repository = new MemoryCoreRepository();
    const service = new CoreAuthService(repository, {
      challengeTtlSeconds: 600,
      sessionSecret: 'test-session-secret-that-is-at-least-32-characters',
      sessionTtlSeconds: 3600,
    });
    const bot = await service.ensureTelegramUser({
      telegramUserId: identity.id,
      telegramFirstName: identity.first_name,
      telegramUsername: identity.username,
    });
    await service.updateTelegramOnboarding(identity.id, { action: 'set_language', language: 'uz' });
    await service.updateTelegramOnboarding(identity.id, { action: 'set_role', role: 'user' });
    await service.updateTelegramOnboarding(identity.id, {
      action: 'accept_terms',
      termsVersion: '2026-09',
    });
    const app = buildApp({
      core: {
        internalBotSecret: 'test-internal-secret-that-is-at-least-32-characters',
        production: false,
        service,
        telegramBotToken: token,
      },
      logger: false,
    });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/telegram/miniapp',
        payload: { initData: signedData(identity) },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().user.duid).toBe(bot.user.duid);
      expect(repository.users.size).toBe(1);
      const cookie = String(login.headers['set-cookie']).split(';', 1)[0]!;
      const me = await app.inject({ method: 'GET', url: '/users/me', headers: { cookie } });
      expect(me.json().user.telegramUserId).toBe(String(identity.id));
      expect(
        (await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } })).statusCode,
      ).toBe(204);
      expect(
        (await app.inject({ method: 'GET', url: '/users/me', headers: { cookie } })).statusCode,
      ).toBe(401);
      const invalid = await app.inject({
        method: 'POST',
        url: '/auth/telegram/miniapp',
        payload: { initData: signedData({ ...identity, id: 42 }).replace('42', '43') },
      });
      expect(invalid.statusCode).toBe(401);
      const expired = await app.inject({
        method: 'POST',
        url: '/auth/telegram/miniapp',
        payload: { initData: signedData(identity, Math.floor(Date.now() / 1000) - 86401) },
      });
      expect(expired.statusCode).toBe(401);
      expect(repository.users.size).toBe(1);
      const newIdentity = { ...identity, id: 280420071 };
      for (let attempt = 0; attempt < 2; attempt++) {
        const incomplete = await app.inject({
          method: 'POST',
          url: '/auth/telegram/miniapp',
          payload: { initData: signedData(newIdentity) },
        });
        expect(incomplete.statusCode).toBe(409);
        expect(incomplete.json()).toMatchObject({ error: { code: 'ONBOARDING_REQUIRED' } });
        expect(incomplete.headers['set-cookie']).toBeUndefined();
      }
      expect(repository.users.size).toBe(2);
      await repository.updateUser(bot.user.id, { status: 'blocked' });
      const blocked = await app.inject({
        method: 'POST',
        url: '/auth/telegram/miniapp',
        payload: { initData: signedData(identity) },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toMatchObject({ error: { code: 'USER_BLOCKED' } });
      expect(blocked.headers['set-cookie']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
