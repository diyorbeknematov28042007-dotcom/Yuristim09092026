import { run, type RunnerHandle, sequentialize } from '@grammyjs/runner';
import type { Bot } from 'grammy';
import type { YuristimBotContext } from './bot.js';

export const BOT_RUNNER_CONCURRENCY = 16;

export function updateConstraints(context: YuristimBotContext): string[] | undefined {
  const constraints: string[] = [];
  if (context.from) constraints.push(`user:${context.from.id}`);
  if (context.chat) constraints.push(`chat:${context.chat.id}`);
  return constraints.length ? constraints : undefined;
}

export function orderedUpdates() {
  return sequentialize<YuristimBotContext>(updateConstraints);
}

export function startBotRunner(bot: Bot<YuristimBotContext>): RunnerHandle {
  return run(bot, {
    runner: {
      maxRetryTime: 60_000,
      retryInterval: 'exponential',
    },
    sink: { concurrency: BOT_RUNNER_CONCURRENCY },
  });
}

export async function stopBotRunner(runner: RunnerHandle): Promise<void> {
  if (runner.isRunning()) await runner.stop();
}
