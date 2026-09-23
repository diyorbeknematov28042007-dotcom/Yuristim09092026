import { describe, expect, it } from 'vitest';
import { Argon2idPinHasher, generateOpaqueToken, hashOpaqueToken } from './crypto.js';

describe('auth cryptography', () => {
  it('hashes a leading-zero PIN with Argon2id without retaining plaintext', async () => {
    const hasher = new Argon2idPinHasher();
    const digest = await hasher.hash('0001');

    expect(digest).toMatch(/^\$argon2id\$/);
    expect(digest).not.toContain('0001');
    await expect(hasher.verify(digest, '0001')).resolves.toBe(true);
    await expect(hasher.verify(digest, '1000')).resolves.toBe(false);
  });

  it('creates opaque tokens and one-way HMAC digests', () => {
    const token = generateOpaqueToken();
    const digest = hashOpaqueToken(token, 'a-secret-that-is-long-enough-for-tests');

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
  });
});
