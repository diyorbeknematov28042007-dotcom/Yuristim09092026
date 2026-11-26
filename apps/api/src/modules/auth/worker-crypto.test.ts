import { hash as nativeHash, verify as nativeVerify } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { WorkerArgon2idPinHasher } from './worker-crypto.js';

describe('Worker-compatible Argon2id PIN compatibility', () => {
  const portable = new WorkerArgon2idPinHasher();
  it('verifies pre-migration native hashes without changing their parameters', async () => {
    const existing = await nativeHash('482739', {
      algorithm: 2,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    expect(await portable.verify(existing, '482739')).toBe(true);
    expect(await portable.verify(existing, 'wrong')).toBe(false);
  }, 20_000);
  it('produces PHC hashes verifiable by the original native implementation', async () => {
    const created = await portable.hash('854722');
    expect(created).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await nativeVerify(created, '854722')).toBe(true);
    expect(await nativeVerify(created, 'wrong')).toBe(false);
    expect(await portable.verify('$argon2id$v=19$m=999999999,t=100,p=1$abc$abc', 'pin')).toBe(
      false,
    );
  }, 20_000);
});
