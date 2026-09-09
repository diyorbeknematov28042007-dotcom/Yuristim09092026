import { randomBytes } from 'node:crypto';

export interface DuidGenerator {
  generate(): string;
}

export class SecureDuidGenerator implements DuidGenerator {
  generate(): string {
    return `yr_${randomBytes(12).toString('base64url')}`;
  }
}
