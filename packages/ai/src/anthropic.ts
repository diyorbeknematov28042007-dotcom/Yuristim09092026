import { assertProviderResponse, assertUsage, number, readSseJson, text } from './sse.js';
import {
  AiProviderError,
  type AiProviderAdapter,
  type AiProviderRequest,
  type AiProviderResponse,
  type AiReasoningEffort,
} from './types.js';

interface AnthropicAdapterOptions {
  apiKey?: string | undefined;
  effort: AiReasoningEffort;
  model: string;
  fetch?: typeof fetch;
}

function responseContent(value: Record<string, unknown>): string {
  const content = Array.isArray(value.content) ? value.content : [];
  return content
    .map((item) =>
      item && typeof item === 'object' ? text((item as Record<string, unknown>).text) : null,
    )
    .filter((item): item is string => item !== null)
    .join('');
}

function responseUsage(value: Record<string, unknown>) {
  const usage =
    value.usage && typeof value.usage === 'object' ? (value.usage as Record<string, unknown>) : {};
  return { inputTokens: number(usage.input_tokens), outputTokens: number(usage.output_tokens) };
}

export class AnthropicAdapter implements AiProviderAdapter {
  readonly name = 'anthropic' as const;
  readonly supportsStreaming = true;
  readonly configured: boolean;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: AnthropicAdapterOptions) {
    this.configured = Boolean(options.apiKey);
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    const response = await this.call(request, false);
    const value: unknown = await response.json().catch(() => null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AiProviderError('unavailable', false);
    }
    const record = value as Record<string, unknown>;
    const content = responseContent(record).trim();
    if (!content) throw new AiProviderError('unavailable', false);
    const usage = responseUsage(record);
    assertUsage(usage.inputTokens, usage.outputTokens);
    return { content, usage };
  }

  async stream(
    request: AiProviderRequest,
    onDelta: (delta: string) => void | Promise<void>,
  ): Promise<AiProviderResponse> {
    const response = await this.call(request, true);
    let content = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const event of readSseJson(response)) {
      if (event.type === 'message_start' && event.message && typeof event.message === 'object') {
        inputTokens = responseUsage(event.message as Record<string, unknown>).inputTokens;
      }
      if (event.type === 'content_block_delta' && event.delta && typeof event.delta === 'object') {
        const delta = text((event.delta as Record<string, unknown>).text);
        if (delta) {
          content += delta;
          await onDelta(delta);
        }
      }
      if (event.type === 'message_delta' && event.usage && typeof event.usage === 'object') {
        outputTokens = number((event.usage as Record<string, unknown>).output_tokens);
      }
    }
    if (!content.trim()) throw new AiProviderError('unavailable', false);
    assertUsage(inputTokens, outputTokens);
    return { content: content.trim(), usage: { inputTokens, outputTokens } };
  }

  private async call(request: AiProviderRequest, stream: boolean): Promise<Response> {
    if (!this.options.apiKey) throw new AiProviderError('configuration', false);
    const response = await this.fetchImplementation('https://api.anthropic.com/v1/messages', {
      body: JSON.stringify({
        max_tokens: request.maxOutputTokens,
        messages: request.messages,
        model: this.options.model,
        output_config: { effort: this.options.effort },
        stream,
        system: request.systemPrompt,
        thinking: { type: 'adaptive' },
      }),
      headers: {
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'x-api-key': this.options.apiKey,
      },
      method: 'POST',
      signal: request.signal,
    });
    await assertProviderResponse(response);
    return response;
  }
}
