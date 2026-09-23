import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export interface PinHasher {
  hash(pin: string): Promise<string>;
  verify(hashValue: string, pin: string): Promise<boolean>;
}

export class Argon2idPinHasher implements PinHasher {
  hash(pin: string): Promise<string> {
    return hash(pin, {
      // @node-rs/argon2 exposes Algorithm as an ambient const enum, which is
      // incompatible with verbatimModuleSyntax. Its documented Argon2id value is 2.
      algorithm: 2,
      memoryCost: 19_456,
      outputLen: 32,
      parallelism: 1,
      timeCost: 2,
    });
  }

  verify(hashValue: string, pin: string): Promise<boolean> {
    return verify(hashValue, pin);
  }
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
