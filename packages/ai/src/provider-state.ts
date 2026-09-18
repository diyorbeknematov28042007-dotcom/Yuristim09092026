import type {
  AiProviderErrorCategory,
  AiProviderName,
  AiProviderRuntimeState,
  AiProviderStateStore,
} from './types.js';

function initialState(provider: AiProviderName, cooldownSeconds: number): AiProviderRuntimeState {
  return {
    circuitState: 'ACTIVE',
    consecutiveFailures: 0,
    cooldownSeconds,
    failureWindowStartedAt: null,
    lastErrorCategory: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    manualEnabled: true,
    pausedUntil: null,
    provider,
  };
}

function secondsBetween(earlier: string, later: Date): number {
  return Math.max(0, (later.getTime() - new Date(earlier).getTime()) / 1_000);
}

/** Test/local state store. Production supplies the shared Supabase-backed implementation. */
export class InMemoryAiProviderStateStore implements AiProviderStateStore {
  private readonly states = new Map<AiProviderName, AiProviderRuntimeState>();

  async getProviderState(provider: AiProviderName): Promise<AiProviderRuntimeState | null> {
    return this.states.get(provider) ?? null;
  }

  async acquireProvider(input: {
    provider: AiProviderName;
    now: Date;
    halfOpenLeaseSeconds: number;
  }): Promise<{ allowed: boolean; state: AiProviderRuntimeState }> {
    const current = this.states.get(input.provider) ?? initialState(input.provider, 300);
    if (!current.manualEnabled || current.circuitState === 'MANUAL_PAUSED') {
      const state = { ...current, circuitState: 'MANUAL_PAUSED' as const };
      this.states.set(input.provider, state);
      return { allowed: false, state };
    }
    if (current.circuitState === 'ACTIVE') {
      this.states.set(input.provider, current);
      return { allowed: true, state: current };
    }
    const pauseExpired = !current.pausedUntil || new Date(current.pausedUntil) <= input.now;
    if (current.circuitState === 'OPEN' && !pauseExpired) {
      return { allowed: false, state: current };
    }
    if (current.circuitState === 'HALF_OPEN' && !pauseExpired) {
      return { allowed: false, state: current };
    }
    const state = {
      ...current,
      circuitState: 'HALF_OPEN' as const,
      pausedUntil: new Date(input.now.getTime() + input.halfOpenLeaseSeconds * 1_000).toISOString(),
    };
    this.states.set(input.provider, state);
    return { allowed: true, state };
  }

  async recordProviderSuccess(input: {
    provider: AiProviderName;
    now: Date;
    baseCooldownSeconds: number;
  }): Promise<AiProviderRuntimeState> {
    const current =
      this.states.get(input.provider) ?? initialState(input.provider, input.baseCooldownSeconds);
    const state: AiProviderRuntimeState = {
      ...current,
      circuitState: current.manualEnabled ? 'ACTIVE' : 'MANUAL_PAUSED',
      consecutiveFailures: 0,
      cooldownSeconds: input.baseCooldownSeconds,
      failureWindowStartedAt: null,
      lastErrorCategory: null,
      lastSuccessAt: input.now.toISOString(),
      pausedUntil: null,
    };
    this.states.set(input.provider, state);
    return state;
  }

  async recordProviderFailure(input: {
    provider: AiProviderName;
    category: AiProviderErrorCategory;
    now: Date;
    failureThreshold: number;
    failureWindowSeconds: number;
    baseCooldownSeconds: number;
    maxCooldownSeconds: number;
    retryAfterSeconds?: number | undefined;
  }): Promise<AiProviderRuntimeState> {
    const current =
      this.states.get(input.provider) ?? initialState(input.provider, input.baseCooldownSeconds);
    const insideWindow =
      current.failureWindowStartedAt !== null &&
      secondsBetween(current.failureWindowStartedAt, input.now) <= input.failureWindowSeconds;
    const failures = insideWindow ? current.consecutiveFailures + 1 : 1;
    const immediateOpen = input.category === 'rate_limit' || input.category === 'configuration';
    const shouldOpen =
      current.circuitState === 'HALF_OPEN' || immediateOpen || failures >= input.failureThreshold;
    const exponentialCooldown =
      current.circuitState === 'HALF_OPEN'
        ? Math.min(
            input.maxCooldownSeconds,
            Math.max(input.baseCooldownSeconds, current.cooldownSeconds) * 2,
          )
        : Math.max(input.baseCooldownSeconds, input.retryAfterSeconds ?? 0);
    const cooldownSeconds = Math.min(input.maxCooldownSeconds, exponentialCooldown);
    const state: AiProviderRuntimeState = {
      ...current,
      circuitState: shouldOpen ? 'OPEN' : 'ACTIVE',
      consecutiveFailures: failures,
      cooldownSeconds,
      failureWindowStartedAt: insideWindow
        ? current.failureWindowStartedAt
        : input.now.toISOString(),
      lastErrorCategory: input.category,
      lastFailureAt: input.now.toISOString(),
      pausedUntil: shouldOpen
        ? new Date(input.now.getTime() + cooldownSeconds * 1_000).toISOString()
        : null,
    };
    this.states.set(input.provider, state);
    return state;
  }

  setManualEnabled(provider: AiProviderName, enabled: boolean): void {
    const current = this.states.get(provider) ?? initialState(provider, 300);
    this.states.set(provider, {
      ...current,
      circuitState: enabled ? 'ACTIVE' : 'MANUAL_PAUSED',
      manualEnabled: enabled,
      pausedUntil: null,
    });
  }
}
