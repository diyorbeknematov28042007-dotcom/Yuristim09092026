import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type BotPerformanceEvent =
  | 'telegram_update_received'
  | 'callback_ack'
  | 'bot_context_ready'
  | 'bot_to_api'
  | 'telegram_response_start'
  | 'telegram_response_complete'
  | 'total_duration';

interface BotPerformanceContext {
  correlationId: string;
  startedAt: number;
}

interface BotPerformanceDetails {
  durationMilliseconds?: number;
  method?: string;
  route?: string;
  statusCode?: number;
  success?: boolean;
}

const performanceContext = new AsyncLocalStorage<BotPerformanceContext>();

export function createBotCorrelationId(): string {
  return `tg_${randomUUID()}`;
}

export function currentBotCorrelationId(): string | undefined {
  return performanceContext.getStore()?.correlationId;
}

export function elapsedBotMilliseconds(): number {
  const state = performanceContext.getStore();
  return state ? Date.now() - state.startedAt : 0;
}

export function recordBotPerformance(
  event: BotPerformanceEvent,
  details: BotPerformanceDetails = {},
): void {
  if (process.env.NODE_ENV === 'test') return;
  const state = performanceContext.getStore();
  console.info({
    component: 'bot_performance',
    correlationId: state?.correlationId,
    event,
    ...details,
  });
}

export async function withBotPerformance<T>(callback: () => Promise<T>): Promise<T> {
  return performanceContext.run(
    { correlationId: createBotCorrelationId(), startedAt: Date.now() },
    callback,
  );
}
