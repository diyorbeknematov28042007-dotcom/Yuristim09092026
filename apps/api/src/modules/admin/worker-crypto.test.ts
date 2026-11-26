import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAdminToken, hashAdminToken } from './worker-crypto.js';

describe('portable admin session cryptography', () => {
  it('keeps the original HMAC namespace and byte representation', async () => {
    const token = 'opaque-session-token';
    const secret = 'secret-with-unicode-ө';
    const original = createHmac('sha256', secret).update(`admin:${token}`).digest('hex');
    expect(await hashAdminToken(token, secret)).toBe(original);
    expect(await hashAdminToken(token, 'another-secret')).not.toBe(original);
  });
  it('generates a 32-byte URL-safe opaque token', () => {
    const first = createAdminToken();
    const second = createAdminToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });
});
