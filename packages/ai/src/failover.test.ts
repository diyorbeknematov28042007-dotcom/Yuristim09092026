import { describe, expect, it, vi } from 'vitest';
import { AiGateway } from './gateway.js';
import { InMemoryAiProviderStateStore } from './provider-state.js';
import {
  AiProviderError,
  type AiExpertProviderName,
  type AiModelConfig,
  type AiProviderAdapter,
  type AiProviderName,
} from './types.js';

const circuit = {
  cooldownSeconds: 300,
  failureThreshold: 3,
  failureWindowSeconds: 120,
  halfOpenLeaseSeconds: 30,
  maxCooldownSeconds: 1_800,
};

function model(mode: 'fast' | 'expert', provider: AiProviderName, enabled = true): AiModelConfig {
  return {
    contextLimit: 16_000,
    enabled,
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

function adapter(
  name: AiProviderName,
  generate: AiProviderAdapter['generate'],
  configured = true,
): AiProviderAdapter {
  return {
    configured,
    generate,
    name,
    stream: async (request, onDelta) => {
      const response = await generate(request);
      await onDelta(response.content);
      return response;
    },
    supportsStreaming: true,
  };
}

function gateway(input: {
  adapters: AiProviderAdapter[];
  mode?: 'auto' | 'fixed';
  fixedProvider?: AiExpertProviderName;
  enabled?: Partial<Record<AiExpertProviderName, boolean>>;
  stateStore?: InMemoryAiProviderStateStore;
  now?: () => Date;
}) {
  return new AiGateway({
    adapters: input.adapters,
    circuitBreaker: circuit,
    expertRouting: {
      ...(input.fixedProvider ? { fixedProvider: input.fixedProvider } : {}),
      mode: input.mode ?? 'auto',
      order: ['bai', 'openai', 'anthropic'],
    },
    maxRetries: 0,
    models: [
      model('fast', 'gemini'),
      model('expert', 'bai', input.enabled?.bai ?? true),
      model('expert', 'openai', input.enabled?.openai ?? true),
      model('expert', 'anthropic', input.enabled?.anthropic ?? true),
    ],
    ...(input.now ? { now: input.now } : {}),
    providerStateStore: input.stateStore ?? new InMemoryAiProviderStateStore(),
    timeoutMilliseconds: 100,
  });
}

const expertRequest = {
  messages: [{ content: 'Savol', role: 'user' as const }],
  mode: 'expert' as const,
  systemPrompt: 'Policy',
};

const success = (content: string) => ({
  content,
  usage: { inputTokens: 10, outputTokens: 5 },
});

describe('Expert provider routing and failover', () => {
  it('uses AUTO priority B.AI → OpenAI → Anthropic', async () => {
    const bai = vi.fn().mockRejectedValue(new AiProviderError('timeout', false));
    const openai = vi.fn().mockRejectedValue(new AiProviderError('unavailable', false));
    const anthropic = vi.fn().mockResolvedValue(success('anthropic'));
    const result = await gateway({
      adapters: [adapter('bai', bai), adapter('openai', openai), adapter('anthropic', anthropic)],
    }).execute(expertRequest);
    expect(result.config.provider).toBe('anthropic');
    expect(bai.mock.invocationCallOrder[0]).toBeLessThan(openai.mock.invocationCallOrder[0]!);
    expect(openai.mock.invocationCallOrder[0]).toBeLessThan(anthropic.mock.invocationCallOrder[0]!);
  });

  it('uses only the selected provider in FIXED mode', async () => {
    const bai = vi.fn();
    const openai = vi.fn().mockRejectedValue(new AiProviderError('unavailable', false));
    const anthropic = vi.fn().mockResolvedValue(success('fallback'));
    await expect(
      gateway({
        adapters: [adapter('bai', bai), adapter('openai', openai), adapter('anthropic', anthropic)],
        fixedProvider: 'openai',
        mode: 'fixed',
      }).execute(expertRequest),
    ).rejects.toMatchObject({ category: 'unavailable' });
    expect(bai).not.toHaveBeenCalled();
    expect(anthropic).not.toHaveBeenCalled();
  });

  it('skips disabled and unconfigured providers', async () => {
    const bai = vi.fn();
    const openai = vi.fn();
    const anthropic = vi.fn().mockResolvedValue(success('healthy'));
    const result = await gateway({
      adapters: [
        adapter('bai', bai),
        adapter('openai', openai, false),
        adapter('anthropic', anthropic),
      ],
      enabled: { bai: false },
    }).execute(expertRequest);
    expect(result.config.provider).toBe('anthropic');
    expect(bai).not.toHaveBeenCalled();
    expect(openai).not.toHaveBeenCalled();
  });

  it('skips a manually paused provider', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    stateStore.setManualEnabled('bai', false);
    const bai = vi.fn();
    const openai = vi.fn().mockResolvedValue(success('healthy'));
    const result = await gateway({
      adapters: [adapter('bai', bai), adapter('openai', openai)],
      stateStore,
    }).execute(expertRequest);
    expect(result.config.provider).toBe('openai');
    expect(bai).not.toHaveBeenCalled();
  });

  it.each([
    ['rate_limit', 900_000],
    ['configuration', undefined],
  ] as const)('opens %s provider and continues routing', async (category, retryAfter) => {
    const stateStore = new InMemoryAiProviderStateStore();
    const bai = vi.fn().mockRejectedValue(new AiProviderError(category, false, 'safe', retryAfter));
    const openai = vi.fn().mockResolvedValue(success('healthy'));
    const result = await gateway({
      adapters: [adapter('bai', bai), adapter('openai', openai)],
      stateStore,
    }).execute(expertRequest);
    expect(result.config.provider).toBe('openai');
    expect(await stateStore.getProviderState('bai')).toMatchObject({
      circuitState: 'OPEN',
      ...(category === 'rate_limit' ? { cooldownSeconds: 900 } : {}),
    });
  });

  it('returns a safe normalized failure when all Expert providers fail', async () => {
    const adapters = (['bai', 'openai', 'anthropic'] as const).map((name) =>
      adapter(name, vi.fn().mockRejectedValue(new Error(`raw ${name} secret response`))),
    );
    await expect(gateway({ adapters }).execute(expertRequest)).rejects.toMatchObject({
      category: 'unknown',
      message: 'AI provider request failed',
    });
  });

  it('fails over before stream output but never mixes providers after a delta', async () => {
    const baiBefore: AiProviderAdapter = {
      configured: true,
      generate: vi.fn(),
      name: 'bai',
      stream: vi.fn().mockRejectedValue(new AiProviderError('unavailable', false)),
      supportsStreaming: true,
    };
    const openai = adapter('openai', vi.fn().mockResolvedValue(success('final')));
    const deltas: string[] = [];
    const before = await gateway({ adapters: [baiBefore, openai] }).execute({
      ...expertRequest,
      onDelta: (delta) => void deltas.push(delta),
    });
    expect(before.config.provider).toBe('openai');
    expect(deltas).toEqual(['final']);

    const baiAfter: AiProviderAdapter = {
      configured: true,
      generate: vi.fn(),
      name: 'bai',
      stream: vi.fn(async (_request, onDelta) => {
        await onDelta('partial');
        throw new AiProviderError('unavailable', true);
      }),
      supportsStreaming: true,
    };
    const fallback = vi.fn().mockResolvedValue(success('must-not-run'));
    await expect(
      gateway({ adapters: [baiAfter, adapter('openai', fallback)] }).execute({
        ...expertRequest,
        onDelta: vi.fn(),
      }),
    ).rejects.toMatchObject({ category: 'unavailable' });
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('provider circuit breaker', () => {
  it('opens at threshold, skips OPEN, then recovers through HALF_OPEN success', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    let current = new Date('2026-09-17T10:00:00.000Z');
    const input = {
      baseCooldownSeconds: 300,
      category: 'timeout' as const,
      failureThreshold: 3,
      failureWindowSeconds: 120,
      maxCooldownSeconds: 1_800,
      now: current,
      provider: 'bai' as const,
    };
    await stateStore.recordProviderFailure(input);
    await stateStore.recordProviderFailure(input);
    expect((await stateStore.recordProviderFailure(input)).circuitState).toBe('OPEN');
    expect(
      (
        await stateStore.acquireProvider({
          halfOpenLeaseSeconds: 30,
          now: current,
          provider: 'bai',
        })
      ).allowed,
    ).toBe(false);
    current = new Date(current.getTime() + 301_000);
    const probe = await stateStore.acquireProvider({
      halfOpenLeaseSeconds: 30,
      now: current,
      provider: 'bai',
    });
    expect(probe).toMatchObject({ allowed: true, state: { circuitState: 'HALF_OPEN' } });
    expect(
      (
        await stateStore.recordProviderSuccess({
          baseCooldownSeconds: 300,
          now: current,
          provider: 'bai',
        })
      ).circuitState,
    ).toBe('ACTIVE');
  });

  it('reopens HALF_OPEN with bounded exponential cooldown', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    const openedAt = new Date('2026-09-17T10:00:00.000Z');
    await stateStore.recordProviderFailure({
      baseCooldownSeconds: 300,
      category: 'configuration',
      failureThreshold: 3,
      failureWindowSeconds: 120,
      maxCooldownSeconds: 1_800,
      now: openedAt,
      provider: 'openai',
    });
    const probeAt = new Date(openedAt.getTime() + 301_000);
    await stateStore.acquireProvider({
      halfOpenLeaseSeconds: 30,
      now: probeAt,
      provider: 'openai',
    });
    const reopened = await stateStore.recordProviderFailure({
      baseCooldownSeconds: 300,
      category: 'unavailable',
      failureThreshold: 3,
      failureWindowSeconds: 120,
      maxCooldownSeconds: 1_800,
      now: probeAt,
      provider: 'openai',
    });
    expect(reopened).toMatchObject({ circuitState: 'OPEN', cooldownSeconds: 600 });
  });

  it('honors manual pause, Retry-After, and auth removal without exposing errors', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    const at = new Date('2026-09-17T10:00:00.000Z');
    stateStore.setManualEnabled('anthropic', false);
    expect(
      (
        await stateStore.acquireProvider({
          halfOpenLeaseSeconds: 30,
          now: at,
          provider: 'anthropic',
        })
      ).state.circuitState,
    ).toBe('MANUAL_PAUSED');
    const limited = await stateStore.recordProviderFailure({
      baseCooldownSeconds: 300,
      category: 'rate_limit',
      failureThreshold: 3,
      failureWindowSeconds: 120,
      maxCooldownSeconds: 1_800,
      now: at,
      provider: 'bai',
      retryAfterSeconds: 900,
    });
    expect(limited).toMatchObject({ circuitState: 'OPEN', cooldownSeconds: 900 });
    const auth = await stateStore.recordProviderFailure({
      baseCooldownSeconds: 300,
      category: 'configuration',
      failureThreshold: 3,
      failureWindowSeconds: 120,
      maxCooldownSeconds: 1_800,
      now: at,
      provider: 'openai',
    });
    expect(auth.circuitState).toBe('OPEN');
  });

  it('does not trip the circuit for invalid user input', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    const generate = vi.fn().mockRejectedValue(new AiProviderError('invalid_request', false));
    await expect(
      gateway({ adapters: [adapter('bai', generate)], stateStore }).execute(expertRequest),
    ).rejects.toMatchObject({ category: 'invalid_request' });
    expect(await stateStore.getProviderState('bai')).toMatchObject({
      circuitState: 'ACTIVE',
      consecutiveFailures: 0,
    });
  });
});
