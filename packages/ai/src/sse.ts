import { AiProviderError } from './types.js';

export async function* readSseJson(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) throw new AiProviderError('unavailable', true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    if (done && buffer.trim()) {
      events.push(buffer);
      buffer = '';
    }
    for (const event of events) {
      const parsed = parseSseEvent(event);
      if (parsed) yield parsed;
    }
    if (done) break;
  }
}

function parseSseEvent(event: string): Record<string, unknown> | null {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return null;
  try {
    const value: unknown = JSON.parse(data);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    throw new Error('SSE JSON must be an object');
  } catch {
    throw new AiProviderError('unavailable', false);
  }
}

export function mapHttpError(status: number): AiProviderError {
  if (status === 400 || status === 404 || status === 422)
    return new AiProviderError('invalid_request', false);
  if (status === 401 || status === 403) return new AiProviderError('configuration', false);
  if (status === 408 || status === 504) return new AiProviderError('timeout', true);
  if (status === 429) return new AiProviderError('rate_limit', true);
  if (status >= 500) return new AiProviderError('unavailable', true);
  return new AiProviderError('unknown', false);
}

export async function assertProviderResponse(response: Response): Promise<void> {
  if (response.ok) return;
  await response.body?.cancel().catch(() => undefined);
  throw mapHttpError(response.status);
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function assertUsage(inputTokens: number, outputTokens: number): void {
  if (
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0 ||
    inputTokens + outputTokens === 0
  ) {
    throw new AiProviderError('unavailable', false);
  }
}
