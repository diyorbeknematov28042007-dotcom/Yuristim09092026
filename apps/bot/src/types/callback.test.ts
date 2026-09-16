import { describe, expect, it } from 'vitest';
import { parseMarketplaceStartParameter } from '../handlers/start.handler.js';
import { parseCallbackData } from './callback.js';

describe('marketplace callback security', () => {
  it('accepts compact opaque marketplace callbacks', () => {
    expect(parseCallbackData('mp:accept:mp_1234567890abcdef12345678')).toBe(
      'mp:accept:mp_1234567890abcdef12345678',
    );
    expect(
      parseCallbackData('mp:select:mp_1234567890abcdef12345678:ma_1234567890abcdef1234'),
    ).not.toBeNull();
  });

  it.each([
    'mp:accept:550e8400-e29b-41d4-a716-446655440000',
    'mp:accept:mp_../../forged',
    `mp:accept:mp_${'a'.repeat(60)}`,
    'mp:rate:mp_1234567890abcdef12345678:6',
  ])('rejects forged or oversized callback %s', (callback) => {
    expect(parseCallbackData(callback)).toBeNull();
  });
});

describe('marketplace deep-link security', () => {
  it('parses only an opaque marketplace start parameter', () => {
    expect(parseMarketplaceStartParameter(' mp_1234567890abcdef12345678 ')).toBe(
      'mp_1234567890abcdef12345678',
    );
    expect(parseMarketplaceStartParameter('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
    expect(parseMarketplaceStartParameter('mp_../../forged')).toBeNull();
  });
});
