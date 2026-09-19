import type { RunnerHandle } from '@grammyjs/runner';
import type { Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import type { YuristimBotContext } from './bot.js';
import { BOT_RUNNER_CONCURRENCY, stopBotRunner, updateConstraints } from './runner.js';

describe('Telegram runner', () => {
  it('uses conservative concurrency with user and chat ordering constraints', () => {
    const context = {
      chat: { id: 22 },
      from: { id: 11 },
    } as unknown as YuristimBotContext;
    expect(BOT_RUNNER_CONCURRENCY).toBe(16);
    expect(updateConstraints(context)).toEqual(['user:11', 'chat:22']);
    expect(updateConstraints({} as Context as YuristimBotContext)).toBeUndefined();
  });

  it('awaits a running runner during graceful shutdown and remains idempotent', async () => {
    let running = true;
    const stop = vi.fn(async () => {
      await Promise.resolve();
      running = false;
    });
    const runner = {
      isRunning: () => running,
      stop,
    } as unknown as RunnerHandle;

    await stopBotRunner(runner);
    await stopBotRunner(runner);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(running).toBe(false);
  });
});
