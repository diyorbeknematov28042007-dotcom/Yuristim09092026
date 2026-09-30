import { describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from './anthropic.js';
import { BaiAdapter } from './bai.js';
import { GeminiAdapter } from './gemini.js';
import { OpenAiAdapter } from './openai.js';
import { assertProviderResponse, mapHttpError, readSseJson } from './sse.js';
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
  it('rejects a truncated Gemini stream even when content and usage look valid', async () => {
    const chunk = {
      candidates: [{ content: { parts: [{ text: '277-modd' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
    };
    const adapter = new GeminiAdapter({
      apiKey: 'test',
      model: 'test',
      thinkingLevel: 'low',
      fetch: async () => new Response(`data: ${JSON.stringify(chunk)}\n\n`),
    });
    const delta = vi.fn();
    await expect(adapter.stream(request(), delta)).rejects.toMatchObject({
      diagnostics: { reason: 'missing_finish' },
    });
    expect(delta).toHaveBeenCalledWith('277-modd');
  });
  it('accepts STOP with a complete Gemini stream', async () => {
    const chunk = {
      candidates: [{ content: { parts: [{ text: 'To‘liq javob' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
    };
    const adapter = new GeminiAdapter({
      apiKey: 'test',
      model: 'test',
      thinkingLevel: 'low',
      fetch: async () => new Response(`data: ${JSON.stringify(chunk)}`),
    });
    await expect(adapter.stream(request(), vi.fn())).resolves.toMatchObject({
      content: 'To‘liq javob',
    });
  });
  it.each(['openai', 'anthropic'] as const)(
    'rejects %s streams missing their terminal event',
    async (provider) => {
      const chunks =
        provider === 'openai'
          ? [{ type: 'response.output_text.delta', delta: 'partial' }]
          : [
              { type: 'message_start', message: { usage: { input_tokens: 10 } } },
              { type: 'content_block_delta', delta: { text: 'partial' } },
              { type: 'message_delta', usage: { output_tokens: 8 } },
            ];
      const fetch = async () =>
        new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''));
      const adapter =
        provider === 'openai'
          ? new OpenAiAdapter({ apiKey: 'test', model: 'test', reasoningEffort: 'low', fetch })
          : new AnthropicAdapter({ apiKey: 'test', model: 'test', effort: 'low', fetch });
      await expect(adapter.stream(request(), vi.fn())).rejects.toMatchObject({
        diagnostics: { reason: 'missing_finish' },
      });
    },
  );
  it('does not confuse unclassified incomplete output with a token limit', async () => {
    const adapter = new OpenAiAdapter({
      apiKey: 'test',
      model: 'test',
      reasoningEffort: 'low',
      fetch: async () =>
        Response.json({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }),
    });
    await expect(adapter.generate(request())).rejects.toMatchObject({
      diagnostics: { reason: 'incomplete_response' },
    });
  });
  it('distinguishes explicit quota exhaustion from a bare 429', async () => {
    await expect(
      assertProviderResponse(
        Response.json(
          { error: { code: 'insufficient_quota', message: 'SECRET' } },
          { status: 429 },
        ),
      ),
    ).rejects.toMatchObject({ diagnostics: { reason: 'quota_exhausted', statusCode: 429 } });
    await expect(
      assertProviderResponse(Response.json({ error: { message: 'SECRET' } }, { status: 429 })),
    ).rejects.toMatchObject({ diagnostics: { reason: 'http_error', statusCode: 429 } });
  });
  it('normalizes Gemini content and usage', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ text: 'Javob' }] }, finishReason: 'STOP' }],
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

  it('does not accept token-limited Gemini output as a completed legal answer', async () => {
    const chunk = {
      candidates: [{ content: { parts: [{ text: 'Yarim javob' }] }, finishReason: 'MAX_TOKENS' }],
      usageMetadata: { candidatesTokenCount: 500, promptTokenCount: 11 },
    };
    const adapter = new GeminiAdapter({
      apiKey: 'test',
      fetch: vi.fn().mockResolvedValue(Response.json(chunk)),
      model: 'gemini-test',
      thinkingLevel: 'low',
    });
    await expect(adapter.generate(request())).rejects.toMatchObject({
      category: 'unavailable',
      diagnostics: { reason: 'output_limit' },
    });
    const streaming = new GeminiAdapter({
      apiKey: 'test',
      fetch: vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(chunk)}\n\n`)),
      model: 'gemini-test',
      thinkingLevel: 'low',
    });
    const onDelta = vi.fn();
    await expect(streaming.stream(request(), onDelta)).rejects.toMatchObject({
      diagnostics: { reason: 'output_limit' },
    });
    expect(onDelta).toHaveBeenCalledWith('Yarim javob');
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

  it('rejects an incomplete Expert response without exposing provider details', async () => {
    const adapter = new OpenAiAdapter({
      apiKey: 'test',
      fetch: vi.fn().mockResolvedValue(
        Response.json({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ content: [{ text: 'Yarim javob' }] }],
          usage: { input_tokens: 10, output_tokens: 500 },
        }),
      ),
      model: 'test',
      reasoningEffort: 'high',
    });
    await expect(adapter.generate(request())).rejects.toMatchObject({
      diagnostics: { reason: 'output_limit' },
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
      model: 'deepseek-v4.1-flash',
      reasoningEffort: 'high',
    });
    await adapter.generate(request());
    expect(adapter.name).toBe('bai');
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.b.ai/v1/responses');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'deepseek-v4.1-flash',
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

  it.each(['model_not_found', 'insufficient_user_quota'])(
    'maps provider configuration code %s to a failover-safe configuration error',
    async (code) => {
      await expect(
        assertProviderResponse(
          Response.json({ error: { code, message: 'provider detail' } }, { status: 400 }),
        ),
      ).rejects.toMatchObject({ category: 'configuration', retryable: false });
    },
  );
});

describe('B1 safe HTTP diagnostics', () => {
  it.each([
    [400, 'invalid_request'],
    [401, 'configuration'],
    [403, 'configuration'],
    [404, 'invalid_request'],
    [408, 'timeout'],
    [409, 'unknown'],
    [429, 'rate_limit'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [504, 'timeout'],
  ])('retains HTTP %i without retaining the provider body', async (status, category) => {
    const response = Response.json(
      { error: { message: 'PRIVATE prompt and credential' } },
      { status: Number(status), headers: { 'retry-after': '2' } },
    );
    await expect(assertProviderResponse(response)).rejects.toMatchObject({
      category,
      message: 'AI provider request failed',
      diagnostics: { statusCode: Number(status), reason: 'http_error' },
      ...(status === 429 ? { retryAfterMilliseconds: 2000 } : {}),
    });
  });

  it('separates malformed Gemini output from an HTTP outage', async () => {
    const adapter = new GeminiAdapter({
      apiKey: 'test',
      model: 'test',
      thinkingLevel: 'low',
      fetch: async () => new Response('not JSON'),
    });
    await expect(adapter.generate(request())).rejects.toMatchObject({
      category: 'unavailable',
      diagnostics: { reason: 'malformed_response' },
    });
  });
});
