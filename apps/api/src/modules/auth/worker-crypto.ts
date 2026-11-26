import { argon2idAsync } from '@noble/hashes/argon2.js';
import type { PinHasher } from './crypto.js';

// Match the existing @node-rs/argon2 PHC hashes byte-for-byte.
const MEMORY_KIB = 19_456;
const ITERATIONS = 2;
const PARALLELISM = 1;
const HASH_BYTES = 32;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const text = new TextEncoder();

function encode(bytes: Uint8Array): string {
  let data = '';
  for (const byte of bytes) data += String.fromCharCode(byte);
  return btoa(data).replace(/=+$/, '');
}
function decode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+$/.test(value)) return null;
  try {
    return Uint8Array.from(atob(value + '='.repeat((4 - (value.length % 4)) % 4)), (char) =>
      char.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

export class WorkerArgon2idPinHasher implements PinHasher {
  async hash(pin: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const digest = await argon2idAsync(text.encode(pin), salt, {
      t: ITERATIONS,
      m: MEMORY_KIB,
      p: PARALLELISM,
      dkLen: HASH_BYTES,
      maxmem: MAX_MEMORY_BYTES,
    });
    const encoded = `$argon2id$v=19$m=${MEMORY_KIB},t=${ITERATIONS},p=${PARALLELISM}$${encode(salt)}$${encode(digest)}`;
    digest.fill(0);
    return encoded;
  }

  async verify(encoded: string, pin: string): Promise<boolean> {
    const parts =
      /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
        encoded,
      );
    if (!parts) return false;
    const m = Number(parts[1]),
      t = Number(parts[2]),
      p = Number(parts[3]);
    // Reject malformed or attacker-controlled resource usage before allocation.
    if (
      !Number.isInteger(m) ||
      m < MEMORY_KIB ||
      m > 65536 ||
      !Number.isInteger(t) ||
      t < ITERATIONS ||
      t > 6 ||
      p !== PARALLELISM
    )
      return false;
    const salt = decode(parts[4]!);
    const expected = decode(parts[5]!);
    if (!salt || salt.length < 8 || salt.length > 32 || !expected || expected.length !== HASH_BYTES)
      return false;
    const actual = await argon2idAsync(text.encode(pin), salt, {
      m,
      t,
      p,
      dkLen: expected.length,
      maxmem: MAX_MEMORY_BYTES,
    });
    let different = 0;
    for (let i = 0; i < expected.length; i++) different |= expected[i]! ^ actual[i]!;
    actual.fill(0);
    expected.fill(0);
    return different === 0;
  }
}
