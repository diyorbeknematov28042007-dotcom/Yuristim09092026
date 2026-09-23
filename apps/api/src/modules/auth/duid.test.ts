import { describe, expect, it } from 'vitest';
import { SecureDuidGenerator } from './duid.js';

describe('SecureDuidGenerator', () => {
  it('creates short URL-safe provisional identifiers', () => {
    const generator = new SecureDuidGenerator();
    expect(generator.generate()).toMatch(/^yr_[A-Za-z0-9_-]{16}$/);
  });

  it('does not collide across a practical sample', () => {
    const generator = new SecureDuidGenerator();
    const values = new Set(Array.from({ length: 1_000 }, () => generator.generate()));
    expect(values.size).toBe(1_000);
  });
});
