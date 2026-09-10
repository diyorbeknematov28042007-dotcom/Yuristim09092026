import { describe, expect, it, vi } from 'vitest';
import {
  createInternalSignature,
  YuristimApiClient,
  YuristimApiError,
} from './yuristim-api.client.js';

const secret = 'test-internal-api-secret-at-least-32-characters';
const identity = {
  telegramFirstName: 'Diyorbek',
  telegramUserId: 123_456_789,
  telegramUsername: 'diyorbek',
};
const apiUser = {
  activeMode: 'user',
  createdAt: '2026-09-09T10:00:00.000Z',
  duid: 'yr_abcdefghijklmnop',
  fullName: null,
  id: '00000000-0000-4000-8000-000000000001',
  language: null,
  onboardingRole: null,
  onboardingStatus: 'language_selection',
  status: 'active',
  telegramFirstName: 'Diyorbek',
  telegramUserId: '123456789',
  telegramUsername: 'diyorbek',
  termsAcceptedAt: null,
  termsVersion: null,
  updatedAt: '2026-09-09T10:00:00.000Z',
};

describe('YuristimApiClient', () => {
  it('adds timestamped HMAC and request ID to an internal API request', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ created: true, user: apiUser })),
    );
    const client = new YuristimApiClient({
      baseUrl: 'http://localhost:3001',
      fetch: fetchMock,
      internalApiSecret: secret,
      now: () => 1_789_000_000_000,
      requestId: () => 'request-1',
    });
    await expect(client.ensureTelegramUser(identity)).resolves.toMatchObject({ created: true });

    const [, request] = fetchMock.mock.calls[0]!;
    const headers = new Headers(request?.headers);
    const timestamp = '1789000000';
    expect(headers.get('x-request-id')).toBe('request-1');
    expect(headers.get('x-yuristim-timestamp')).toBe(timestamp);
    expect(headers.get('x-yuristim-signature')).toBe(
      createInternalSignature(
        'POST',
        '/internal/telegram/users/ensure',
        identity,
        timestamp,
        secret,
      ),
    );
    expect(headers.get('x-yuristim-signature')).not.toContain(secret);
  });

  it('maps structured API errors without leaking server details', async () => {
    const client = new YuristimApiClient({
      baseUrl: 'http://localhost:3001',
      fetch: () =>
        Promise.resolve(
          Response.json({ error: { code: 'USER_BLOCKED', message: 'hidden' } }, { status: 403 }),
        ),
      internalApiSecret: secret,
    });
    await expect(client.getTelegramUserContext(identity.telegramUserId)).rejects.toMatchObject({
      code: 'USER_BLOCKED',
      message: 'Yuristim API request failed',
      statusCode: 403,
    });
  });

  it('rejects malformed successful responses', async () => {
    const client = new YuristimApiClient({
      baseUrl: 'http://localhost:3001',
      fetch: () => Promise.resolve(Response.json({ unexpected: true })),
      internalApiSecret: secret,
    });
    await expect(client.ensureTelegramUser(identity)).rejects.toBeInstanceOf(YuristimApiError);
    await expect(client.ensureTelegramUser(identity)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('bounds a stalled request with a timeout', async () => {
    const stalledFetch = (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const client = new YuristimApiClient({
      baseUrl: 'http://localhost:3001',
      fetch: stalledFetch,
      internalApiSecret: secret,
      timeoutMilliseconds: 5,
    });
    await expect(client.ensureTelegramUser(identity)).rejects.toMatchObject({
      code: 'API_UNAVAILABLE',
      statusCode: 503,
    });
  });
});
