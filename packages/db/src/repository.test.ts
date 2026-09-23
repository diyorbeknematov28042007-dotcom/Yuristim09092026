import { describe, expect, it } from 'vitest';
import { DuplicateDuidError, DuplicateTelegramUserError, jsonObject } from './repository.js';

describe('database boundary', () => {
  it('uses distinct errors for database uniqueness constraints', () => {
    expect(new DuplicateDuidError().name).toBe('DuplicateDuidError');
    expect(new DuplicateTelegramUserError().name).toBe('DuplicateTelegramUserError');
  });

  it('accepts only JSON objects as tag metadata', () => {
    expect(jsonObject({ student: true })).toEqual({ student: true });
    expect(jsonObject(['student'])).toEqual({});
    expect(jsonObject(null)).toEqual({});
  });
});
