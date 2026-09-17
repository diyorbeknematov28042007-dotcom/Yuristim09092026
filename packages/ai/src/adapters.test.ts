import { describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from './anthropic.js';
import { BaiAdapter } from './bai.js';
import { GeminiAdapter } from './gemini.js';
import { OpenAiAdapter } from './openai.js';
import { mapHttpError, readSseJson } from './sse.js';
import type { AiProviderRequest } from './types.js';

function request(): AiProviderRequest {
  return {
    maxOutputTokens: 500,
    messages: [{ content: 'Savol', role: 'user' }],
    signal: new AbortController().signal,
    systemPrompt: 'Policy',
  };
}

describe('provider adapters', () => {
  it('normalizes Gemini content and usage', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ text: 'Javob' }] } }],
        usageMetadata: { candidatesTokenCount: 7, promptTokenCount: 11 },
      }),
    );
    const result = await new GeminiAdapter({
      apiKey: 'test',
      fetch,
      model: 'gemini-3.8-flash',
      thinkingLevel: 'low',
    }).generate(request());
    expect(result).toEqual({ content: 'Javob', usage: { inputTokens: 11, outputTokens: 7 } });
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-goog-api-key': 'test' });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    });
  });

  it('normalizes OpenAI Responses output without leaking its provider shape', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        output: [{ content: [{ text: 'Expert answer', type: 'output_text' }] }],
        usage: { input_tokens: 21, output_tokens: 9 },
      }),
    );
    const result = await new OpenAiAdapter({
      apiKey: 'test',
      fetch,
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    }).generate(request());
    expect(result).toEqual({
      content: 'Expert answer',
      usage: { inputTokens: 21, outputTokens: 9 },
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'high' },
    });
  });

  it('maps B.AI to its own identity with OpenAI-compatible reasoning semantics', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        output: [{ content: [{ text: 'B.AI answer', type: 'output_text' }] }],
        usage: { input_tokens: 15, output_tokens: 8 },
      }),
    );
    const adapter = new BaiAdapter({
      apiKey: 'test',
      baseUrl: 'https://api.b.ai/v1',
      fetch,
      model: 'DeepSeek-V4.1-Flash',
      reasoningEffort: 'high',
    });
    await adapter.generate(request());
    expect(adapter.name).toBe('bai');
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.b.ai/v1/responses');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'DeepSeek-V4.1-Flash',
      reasoning: { effort: 'high' },
    });
  });

  it('normalizes Anthropic Messages output and usage', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        content: [{ text: 'Deep answer', type: 'text' }],
        usage: { input_tokens: 17, output_tokens: 12 },
      }),
    );
    const result = await new AnthropicAdapter({
      apiKey: 'test',
      effort: 'high',
      fetch,
      model: 'claude-opus-5',
    }).generate(request());
    expect(result).toEqual({
      content: 'Deep answer',
      usage: { inputTokens: 17, outputTokens: 12 },
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'claude-opus-5',
      output_config: { effort: 'high' },
      thinking: { type: 'adaptive' },
    });
  });

  it('rejects usable-looking content when provider usage is malformed', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ candidates: [{ content: { parts: [{ text: 'No usage' }] } }] }),
      );
    await expect(
      new GeminiAdapter({
        apiKey: 'test',
        fetch,
        model: 'gemini-3.8-flash',
        thinkingLevel: 'low',
      }).generate(request()),
    ).rejects.toMatchObject({ category: 'unavailable' });
  });

  it('parses a final SSE event even when the stream has no trailing blank line', async () => {
    const response = new Response('data: {"type":"final","ok":true}');
    const events = [];
    for await (const event of readSseJson(response)) events.push(event);
    expect(events).toEqual([{ ok: true, type: 'final' }]);
  });

  it.each([
    [400, 'invalid_request', false],
    [401, 'configuration', false],
    [429, 'rate_limit', true],
    [503, 'unavailable', true],
  ] as const)('maps HTTP %s to %s', (status, category, retryable) => {
    expect(mapHttpError(status)).toMatchObject({ category, retryable });
  });
});
