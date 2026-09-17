import { assertProviderResponse, assertUsage, number, readSseJson, text } from './sse.js';
import {
  AiProviderError,
  type AiProviderAdapter,
  type AiProviderRequest,
  type AiProviderResponse,
} from './types.js';

interface OpenAiAdapterOptions {
  apiKey?: string | undefined;
  model: string;
  fetch?: typeof fetch;
}

function requestBody(request: AiProviderRequest, stream: boolean) {
  return {
    input: request.messages.map((message) => ({ content: message.content, role: message.role })),
    instructions: request.systemPrompt,
    max_output_tokens: request.maxOutputTokens,
    model: '',
    stream,
  };
}

function responseContent(value: Record<string, unknown>): string {
  const output = Array.isArray(value.output) ? value.output : [];
  return output
    .flatMap((item) =>
      item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).content)
        ? ((item as Record<string, unknown>).content as unknown[])
        : [],
    )
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

export class OpenAiAdapter implements AiProviderAdapter {
  readonly name = 'openai' as const;
  readonly supportsStreaming = true;
  readonly configured: boolean;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: OpenAiAdapterOptions) {
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
    let usage = { inputTokens: 0, outputTokens: 0 };
    for await (const event of readSseJson(response)) {
      if (event.type === 'response.output_text.delta') {
        const delta = text(event.delta);
        if (delta) {
          content += delta;
          await onDelta(delta);
        }
      }
      if (
        event.type === 'response.completed' &&
        event.response &&
        typeof event.response === 'object'
      ) {
        const completed = event.response as Record<string, unknown>;
        usage = responseUsage(completed);
        if (!content) content = responseContent(completed);
      }
    }
    if (!content.trim()) throw new AiProviderError('unavailable', false);
    assertUsage(usage.inputTokens, usage.outputTokens);
    return { content: content.trim(), usage };
  }

  private async call(request: AiProviderRequest, stream: boolean): Promise<Response> {
    if (!this.options.apiKey) throw new AiProviderError('configuration', false);
    const body = requestBody(request, stream);
    body.model = this.options.model;
    const response = await this.fetchImplementation('https://api.openai.com/v1/responses', {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: request.signal,
    });
    await assertProviderResponse(response);
    return response;
  }
}
