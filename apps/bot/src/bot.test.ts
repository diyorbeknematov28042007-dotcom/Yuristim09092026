import { Bot } from 'grammy';
import { describe, expect, it } from 'vitest';
import { createBot } from './bot.js';

describe('createBot', () => {
  it('creates an importable grammY bot without starting polling', () => {
    const bot = createBot({
      apiBaseUrl: 'http://localhost:3001',
      internalApiSecret: 'test-internal-api-secret-32-characters',
      token: 'test-token',
    });

    expect(bot).toBeInstanceOf(Bot);
  });
});
