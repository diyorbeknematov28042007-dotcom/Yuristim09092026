import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvironmentValidationError, parseEnv } from './env.js';

describe('parseEnv', () => {
  it('returns typed, validated values', () => {
    const schema = z.object({
      PORT: z.coerce.number().int().positive(),
    });

    expect(parseEnv(schema, { PORT: '3001' })).toEqual({ PORT: 3001 });
  });

  it('reports variable names without leaking values', () => {
    const schema = z.object({
      SECRET: z.string().min(10),
    });
    const secret = 'short';

    expect(() => parseEnv(schema, { SECRET: secret })).toThrow(EnvironmentValidationError);

    try {
      parseEnv(schema, { SECRET: secret });
    } catch (error) {
      expect(String(error)).toContain('SECRET');
      expect(String(error)).not.toContain(secret);
    }
  });
});
