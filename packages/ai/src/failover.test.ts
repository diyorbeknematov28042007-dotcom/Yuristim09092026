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
  maxRetries?: number;
  timeoutMilliseconds?: number;
  totalTimeoutMilliseconds?: number;
}) {
  return new AiGateway({
    adapters: input.adapters,
    circuitBreaker: circuit,
    expertRouting: {
      ...(input.fixedProvider ? { fixedProvider: input.fixedProvider } : {}),
      mode: input.mode ?? 'auto',
      order: ['bai', 'openai', 'anthropic'],
    },
    maxRetries: input.maxRetries ?? 0,
    models: [
      model('fast', 'gemini'),
      model('expert', 'bai', input.enabled?.bai ?? true),
      model('expert', 'openai', input.enabled?.openai ?? true),
      model('expert', 'anthropic', input.enabled?.anthropic ?? true),
    ],
    ...(input.now ? { now: input.now } : {}),
    providerStateStore: input.stateStore ?? new InMemoryAiProviderStateStore(),
    timeoutMilliseconds: input.timeoutMilliseconds ?? 100,
    ...(input.totalTimeoutMilliseconds
      ? { totalTimeoutMilliseconds: input.totalTimeoutMilliseconds }
      : {}),
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

describe('B1 gateway dependency failures', () => {
  it('keeps a successful answer when recording provider success fails', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    vi.spyOn(stateStore, 'recordProviderSuccess').mockRejectedValue(new Error('DB transient'));
    const generate = vi.fn().mockResolvedValue(success('answer'));
    await expect(
      gateway({ adapters: [adapter('bai', generate)], stateStore }).execute(expertRequest),
    ).resolves.toMatchObject({ content: 'answer' });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('continues Expert failover when failure-state persistence fails', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    vi.spyOn(stateStore, 'recordProviderFailure').mockRejectedValue(new Error('DB transient'));
    const bai = vi.fn().mockRejectedValue(new AiProviderError('unavailable', false));
    const openai = vi.fn().mockResolvedValue(success('fallback'));
    await expect(
      gateway({ adapters: [adapter('bai', bai), adapter('openai', openai)], stateStore }).execute(
        expertRequest,
      ),
    ).resolves.toMatchObject({ content: 'fallback' });
  });

  it('never calls a provider whose shared admission check fails', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    const acquire = stateStore.acquireProvider.bind(stateStore);
    vi.spyOn(stateStore, 'acquireProvider').mockImplementation((input) =>
      input.provider === 'bai' ? Promise.reject(new Error('DB transient')) : acquire(input),
    );
    const bai = vi.fn();
    const openai = vi.fn().mockResolvedValue(success('fallback'));
    await expect(
      gateway({ adapters: [adapter('bai', bai), adapter('openai', openai)], stateStore }).execute(
        expertRequest,
      ),
    ).resolves.toMatchObject({ content: 'fallback' });
    expect(bai).not.toHaveBeenCalled();
  });
});

describe('B1 controlled concurrency and circuit probes', () => {
  it.each([1, 5, 16, 32])(
    'handles %i independent mocked AI requests without loss',
    async (count) => {
      let active = 0;
      let peak = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const generate = vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate;
        active -= 1;
        return success('answer');
      });
      const ai = gateway({ adapters: [adapter('gemini', generate)] });
      const requests = Array.from({ length: count }, () =>
        ai.execute({ ...expertRequest, mode: 'fast' }),
      );
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(count));
      release();
      const results = await Promise.all(requests);
      expect(results).toHaveLength(count);
      expect(peak).toBe(count);
      expect(results.every((result) => result.config.provider === 'gemini')).toBe(true);
    },
  );

  it('allows only one half-open probe across two gateway instances sharing state', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    const now = new Date('2026-09-25T00:00:00Z');
    await stateStore.recordProviderFailure({
      provider: 'gemini',
      category: 'unavailable',
      now,
      baseCooldownSeconds: 300,
      failureThreshold: 1,
      failureWindowSeconds: 120,
      maxCooldownSeconds: 1800,
    });
    const probeTime = () => new Date(now.getTime() + 301_000);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async () => {
      await gate;
      return success('probe');
    });
    const options = { adapters: [adapter('gemini', generate)], stateStore, now: probeTime };
    const first = gateway(options).execute({ ...expertRequest, mode: 'fast' });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await expect(
      gateway(options).execute({ ...expertRequest, mode: 'fast' }),
    ).rejects.toMatchObject({ category: 'unavailable' });
    release();
    await first;
    expect((await stateStore.getProviderState('gemini'))?.circuitState).toBe('ACTIVE');
  });

  it('reports dropped attempt telemetry without losing the provider result', async () => {
    const onDiagnostic = vi.fn();
    const result = await gateway({
      adapters: [adapter('bai', async () => success('answer'))],
    }).execute({
      ...expertRequest,
      onAttempt: () => {
        throw new Error('private DB error');
      },
      onDiagnostic,
    });
    expect(result.content).toBe('answer');
    expect(onDiagnostic).toHaveBeenCalledWith({
      operation: 'record_attempt',
      provider: 'bai',
      attemptNumber: 1,
    });
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('private DB error');
  });
});

describe('B1 request time budgets', () => {
  it('bounds all Fast retries by one total provider budget', async () => {
    vi.useFakeTimers();
    try {
      const generate = vi.fn(
        (request) =>
          new Promise<never>((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error('abort')), {
              once: true,
            });
          }),
      );
      const ai = gateway({
        adapters: [adapter('gemini', generate)],
        maxRetries: 2,
        timeoutMilliseconds: 40,
        totalTimeoutMilliseconds: 50,
      });
      let settled = false;
      const pending = ai.execute({ ...expertRequest, mode: 'fast' }).catch((error) => {
        settled = true;
        return error;
      });
      await vi.advanceTimersByTimeAsync(55);
      // Backoff is bounded by the remaining request budget as well.
      const withinBudget = settled;
      await vi.advanceTimersByTimeAsync(1000);
      const error = await pending;
      expect(withinBudget).toBe(true);
      expect(error).toMatchObject({
        category: 'timeout',
        diagnostics: { reason: 'request_budget' },
      });
      expect(generate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['paused', 'open', 'store_failure'] as const)(
    'retains a retry when all fallbacks are %s',
    async (failure) => {
      const stateStore = new InMemoryAiProviderStateStore();
      if (failure === 'paused') stateStore.setManualEnabled('openai', false);
      if (failure === 'open') {
        await stateStore.recordProviderFailure({
          provider: 'openai',
          category: 'rate_limit',
          now: new Date(),
          baseCooldownSeconds: 300,
          failureThreshold: 3,
          failureWindowSeconds: 120,
          maxCooldownSeconds: 1800,
        });
      }
      if (failure === 'store_failure') {
        const acquire = stateStore.acquireProvider.bind(stateStore);
        vi.spyOn(stateStore, 'acquireProvider').mockImplementation((input) =>
          input.provider === 'openai' ? Promise.reject(new Error('database')) : acquire(input),
        );
      }
      const bai = vi
        .fn()
        .mockRejectedValueOnce(new AiProviderError('unavailable', true))
        .mockResolvedValueOnce(success('retried'));
      const openai = vi.fn();
      await expect(
        gateway({
          adapters: [adapter('bai', bai), adapter('openai', openai)],
          maxRetries: 1,
          stateStore,
        }).execute(expertRequest),
      ).resolves.toMatchObject({ content: 'retried' });
      expect(bai).toHaveBeenCalledTimes(2);
      expect(openai).not.toHaveBeenCalled();
    },
  );

  it('does not bypass a circuit that opens before a deferred retry', async () => {
    const stateStore = new InMemoryAiProviderStateStore();
    const record = stateStore.recordProviderFailure.bind(stateStore);
    vi.spyOn(stateStore, 'recordProviderFailure').mockImplementation((input) =>
      record({ ...input, failureThreshold: 1 }),
    );
    stateStore.setManualEnabled('openai', false);
    const bai = vi.fn().mockRejectedValue(new AiProviderError('unavailable', true));
    await expect(
      gateway({
        adapters: [adapter('bai', bai), adapter('openai', vi.fn())],
        maxRetries: 1,
        stateStore,
      }).execute(expertRequest),
    ).rejects.toMatchObject({ diagnostics: { reason: 'circuit_open' } });
    expect(bai).toHaveBeenCalledOnce();
  });

  it('bounds deferred attempts by the original per-provider retry allowance', async () => {
    const bai = vi.fn().mockRejectedValue(new AiProviderError('unavailable', true));
    const openai = vi.fn().mockRejectedValue(new AiProviderError('unavailable', true));
    await expect(
      gateway({
        adapters: [adapter('bai', bai), adapter('openai', openai)],
        maxRetries: 1,
      }).execute(expertRequest),
    ).rejects.toMatchObject({ category: 'unavailable' });
    expect(bai).toHaveBeenCalledTimes(2);
    expect(openai).toHaveBeenCalledTimes(2);
  });

  it('spends the next Expert attempt on a healthy fallback before repeating a failed provider', async () => {
    const bai = vi.fn().mockRejectedValue(new AiProviderError('unavailable', true));
    const openai = vi.fn().mockResolvedValue(success('fallback'));
    const result = await gateway({
      adapters: [adapter('bai', bai), adapter('openai', openai)],
      maxRetries: 1,
    }).execute(expertRequest);
    expect(result.content).toBe('fallback');
    expect(bai).toHaveBeenCalledOnce();
  });
});
