import { Bot } from 'grammy';
import { describe, expect, it } from 'vitest';
import { createBot } from './bot.js';

describe('createBot', () => {
  it('creates an importable grammY bot without starting polling', () => {
    const bot = createBot({
      apiBaseUrl: 'http://localhost:3001',
      token: 'test-token',
    });

    expect(bot).toBeInstanceOf(Bot);
  });
});
