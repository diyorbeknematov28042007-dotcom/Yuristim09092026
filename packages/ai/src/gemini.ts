import { assertProviderResponse, assertUsage, number, readSseJson, text } from './sse.js';
import {
  AiProviderError,
  type AiProviderAdapter,
  type AiProviderRequest,
  type AiProviderResponse,
  type AiThinkingLevel,
} from './types.js';

interface GeminiAdapterOptions {
  apiKey?: string | undefined;
  model: string;
  thinkingLevel: AiThinkingLevel;
  fetch?: typeof fetch;
}

function requestBody(request: AiProviderRequest, thinkingLevel: AiThinkingLevel) {
  return {
    contents: request.messages.map((message) => ({
      parts: [{ text: message.content }],
      role: message.role === 'assistant' ? 'model' : 'user',
    })),
    generationConfig: {
      maxOutputTokens: request.maxOutputTokens,
      thinkingConfig: { thinkingLevel },
    },
    systemInstruction: { parts: [{ text: request.systemPrompt }] },
  };
}

function parseChunk(value: Record<string, unknown>): {
  content: string;
  inputTokens: number;
  outputTokens: number;
} {
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  const candidate = candidates[0];
  const contentValue =
    candidate && typeof candidate === 'object'
      ? (candidate as Record<string, unknown>).content
      : undefined;
  const parts =
    contentValue && typeof contentValue === 'object'
      ? (contentValue as Record<string, unknown>).parts
      : undefined;
  const content = Array.isArray(parts)
    ? parts
        .map((part) =>
          part && typeof part === 'object' ? text((part as Record<string, unknown>).text) : null,
        )
        .filter((part): part is string => part !== null)
        .join('')
    : '';
  const usage =
    value.usageMetadata && typeof value.usageMetadata === 'object'
      ? (value.usageMetadata as Record<string, unknown>)
      : {};
  return {
    content,
    inputTokens: number(usage.promptTokenCount),
    outputTokens: number(usage.candidatesTokenCount),
  };
}

export class GeminiAdapter implements AiProviderAdapter {
  readonly name = 'gemini' as const;
  readonly supportsStreaming = true;
  readonly configured: boolean;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: GeminiAdapterOptions) {
    this.configured = Boolean(options.apiKey);
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    const response = await this.call('generateContent', request);
    const value: unknown = await response.json().catch(() => null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AiProviderError('unavailable', false);
    }
    const parsed = parseChunk(value as Record<string, unknown>);
    if (!parsed.content.trim()) throw new AiProviderError('unavailable', false);
    assertUsage(parsed.inputTokens, parsed.outputTokens);
    return {
      content: parsed.content.trim(),
      usage: { inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens },
    };
  }

  async stream(
    request: AiProviderRequest,
    onDelta: (delta: string) => void | Promise<void>,
  ): Promise<AiProviderResponse> {
    const response = await this.call('streamGenerateContent?alt=sse', request);
    let content = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const value of readSseJson(response)) {
      const parsed = parseChunk(value);
      if (parsed.content) {
        content += parsed.content;
        await onDelta(parsed.content);
      }
      inputTokens = parsed.inputTokens || inputTokens;
      outputTokens = parsed.outputTokens || outputTokens;
    }
    if (!content.trim()) throw new AiProviderError('unavailable', false);
    assertUsage(inputTokens, outputTokens);
    return { content: content.trim(), usage: { inputTokens, outputTokens } };
  }

  private async call(action: string, request: AiProviderRequest): Promise<Response> {
    if (!this.options.apiKey) throw new AiProviderError('configuration', false);
    const response = await this.fetchImplementation(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.options.model)}:${action}`,
      {
        body: JSON.stringify(requestBody(request, this.options.thinkingLevel)),
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.options.apiKey,
        },
        method: 'POST',
        signal: request.signal,
      },
    );
    await assertProviderResponse(response);
    return response;
  }
}
