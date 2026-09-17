import { describe, expect, it, vi } from 'vitest';
import { AiGateway } from './gateway.js';
import {
  AiProviderError,
  type AiModelConfig,
  type AiProviderAdapter,
  type AiProviderName,
} from './types.js';

function model(mode: 'fast' | 'expert', provider: AiProviderName): AiModelConfig {
  return {
    contextLimit: 16_000,
    enabled: true,
    estimateOutputTokens: 256,
    inputCostPerMillionUsd: 1,
    markupMultiplier: 1.5,
    maxOutputTokens: 512,
    mode,
    model: `${provider}-model`,
    outputCostPerMillionUsd: 5,
    provider,
    supportsStreaming: true,
    usdPerCredit: 0.002,
  };
}

function adapter(name: AiProviderName, generate: AiProviderAdapter['generate']): AiProviderAdapter {
  return {
    configured: true,
    generate,
    name,
    stream: async (request, onDelta) => {
      const result = await generate(request);
      await onDelta(result.content);
      return result;
    },
    supportsStreaming: true,
  };
}

function gateway(adapters: AiProviderAdapter[], maxRetries = 0): AiGateway {
  return new AiGateway({
    adapters,
    maxRetries,
    models: [model('fast', 'gemini'), model('expert', 'openai')],
    timeoutMilliseconds: 25,
    wait: () => Promise.resolve(),
  });
}

const request = {
  messages: [{ content: 'Savol', role: 'user' as const }],
  mode: 'fast' as const,
  systemPrompt: 'System',
};

describe('AiGateway', () => {
  it('enforces Gemini-only fast routing at configuration time', () => {
    expect(
      () =>
        new AiGateway({
          adapters: [],
          maxRetries: 0,
          models: [model('fast', 'openai'), model('expert', 'openai')],
          timeoutMilliseconds: 25,
        }),
    ).toThrow('Gemini only');
  });

  it('routes fast only to Gemini and never falls back to another provider', async () => {
    const gemini = vi.fn().mockRejectedValue(new AiProviderError('unavailable', false));
    const openai = vi.fn().mockResolvedValue({
      content: 'fallback',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await expect(
      gateway([adapter('gemini', gemini), adapter('openai', openai)]).execute(request),
    ).rejects.toMatchObject({ category: 'unavailable' });
    expect(gemini).toHaveBeenCalledOnce();
    expect(openai).not.toHaveBeenCalled();
  });

  it('uses bounded same-provider retry for transient failures', async () => {
    const gemini = vi
      .fn()
      .mockRejectedValueOnce(new AiProviderError('rate_limit', true))
      .mockResolvedValue({ content: 'ok', usage: { inputTokens: 10, outputTokens: 5 } });
    const result = await gateway([adapter('gemini', gemini)], 1).execute(request);
    expect(result.content).toBe('ok');
    expect(gemini).toHaveBeenCalledTimes(2);
  });

  it('routes expert requests through the configured hidden provider', async () => {
    const gemini = vi.fn();
    const openai = vi
      .fn()
      .mockResolvedValue({ content: 'expert', usage: { inputTokens: 20, outputTokens: 9 } });
    const result = await gateway([adapter('gemini', gemini), adapter('openai', openai)]).execute({
      ...request,
      mode: 'expert',
    });
    expect(result.content).toBe('expert');
    expect(openai).toHaveBeenCalledOnce();
    expect(gemini).not.toHaveBeenCalled();
  });

  it('normalizes unknown provider failures without exposing raw errors', async () => {
    const gemini = vi.fn().mockRejectedValue(new Error('secret raw provider body'));
    await expect(gateway([adapter('gemini', gemini)]).execute(request)).rejects.toEqual(
      expect.objectContaining({ category: 'unknown', message: 'AI provider request failed' }),
    );
  });

  it('times out a provider call with a finite normalized timeout', async () => {
    const gemini = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    await expect(gateway([adapter('gemini', gemini)]).execute(request)).rejects.toMatchObject({
      category: 'timeout',
    });
  });

  it('does not retry a stream after any content was emitted', async () => {
    const stream = vi.fn(async (_request, onDelta: (value: string) => Promise<void>) => {
      await onDelta('partial');
      throw new AiProviderError('unavailable', true);
    });
    const gemini: AiProviderAdapter = {
      configured: true,
      generate: vi.fn(),
      name: 'gemini',
      stream,
      supportsStreaming: true,
    };
    await expect(
      gateway([gemini], 2).execute({ ...request, onDelta: vi.fn() }),
    ).rejects.toMatchObject({ category: 'unavailable' });
    expect(stream).toHaveBeenCalledOnce();
  });
});
