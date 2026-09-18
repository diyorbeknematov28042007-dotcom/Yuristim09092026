import {
  AiProviderError,
  type AiCircuitBreakerConfig,
  type AiExecutionRequest,
  type AiExecutionResult,
  type AiExpertProviderName,
  type AiExpertRoutingConfig,
  type AiMode,
  type AiModelConfig,
  type AiProviderAdapter,
  type AiProviderAttemptEvent,
  type AiProviderErrorCategory,
  type AiProviderName,
  type AiProviderResponse,
  type AiProviderStateStore,
  type AiProviderStatus,
} from './types.js';

interface AiGatewayOptions {
  adapters: AiProviderAdapter[];
  models: AiModelConfig[];
  timeoutMilliseconds: number;
  maxRetries: number;
  expertRouting?: AiExpertRoutingConfig | undefined;
  circuitBreaker: AiCircuitBreakerConfig;
  providerStateStore: AiProviderStateStore;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

interface AttemptSignal {
  signal: AbortSignal;
  cleanup(): void;
  timedOut(): boolean;
}

const PROVIDERS: AiProviderName[] = ['gemini', 'bai', 'openai', 'anthropic'];

function modelKey(mode: AiMode, provider: AiProviderName): string {
  return `${mode}:${provider}`;
}

function attemptSignal(
  external: AbortSignal | undefined,
  timeoutMilliseconds: number,
): AttemptSignal {
  const controller = new AbortController();
  let timeoutReached = false;
  const timer = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, timeoutMilliseconds);
  const abort = () => controller.abort();
  if (external) {
    if (external.aborted) abort();
    else external.addEventListener('abort', abort, { once: true });
  }
  return {
    cleanup() {
      clearTimeout(timer);
      external?.removeEventListener('abort', abort);
    },
    signal: controller.signal,
    timedOut: () => timeoutReached,
  };
}

function normalizedError(
  error: unknown,
  signal: AttemptSignal,
  external: AbortSignal | undefined,
): AiProviderError {
  if (external?.aborted) return new AiProviderError('cancelled', false);
  if (signal.timedOut()) return new AiProviderError('timeout', true);
  if (error instanceof AiProviderError) return error;
  if (error instanceof TypeError) return new AiProviderError('unavailable', true);
  return new AiProviderError('unknown', false);
}

function circuitRelevant(category: AiProviderErrorCategory): boolean {
  return !['cancelled', 'invalid_request'].includes(category);
}

function failoverAllowed(category: AiProviderErrorCategory): boolean {
  return !['cancelled', 'invalid_request'].includes(category);
}

function sameProviderRetryAllowed(error: AiProviderError): boolean {
  return error.retryable && !['configuration', 'rate_limit'].includes(error.category);
}

function statusAvailable(status: AiProviderStatus): boolean {
  return (
    status.configured &&
    status.enabled &&
    (status.state === 'ACTIVE' || status.state === 'HALF_OPEN')
  );
}

export class AiGateway {
  private readonly adapters: Map<AiProviderName, AiProviderAdapter>;
  private readonly models: Map<string, AiModelConfig>;
  private readonly fastModel: AiModelConfig;
  private readonly expertRouting: AiExpertRoutingConfig;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly options: AiGatewayOptions) {
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.name, adapter]));
    this.models = new Map(
      options.models.map((model) => [modelKey(model.mode, model.provider), model]),
    );
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => new Date());

    const fastModels = options.models.filter((model) => model.mode === 'fast');
    const fast = fastModels[0];
    if (
      !fast ||
      fast.provider !== 'gemini' ||
      fastModels.some((model) => model.provider !== 'gemini')
    ) {
      throw new Error('Fast AI mode must be configured with Gemini only');
    }
    this.fastModel = fast;

    const firstExpert = options.models.find((model) => model.mode === 'expert');
    this.expertRouting =
      options.expertRouting ??
      ({
        fixedProvider: firstExpert?.provider as AiExpertProviderName | undefined,
        mode: 'fixed',
        order: firstExpert ? [firstExpert.provider as AiExpertProviderName] : [],
      } satisfies AiExpertRoutingConfig);
    if (this.expertRouting.mode === 'fixed' && !this.expertRouting.fixedProvider) {
      throw new Error('Fixed Expert AI mode requires a provider');
    }
  }

  config(mode: AiMode): AiModelConfig {
    if (mode === 'fast') {
      if (!this.fastModel.enabled) throw new AiProviderError('configuration', false);
      return this.fastModel;
    }
    const candidates = this.expertConfigs();
    const available = candidates.find(
      (config) => config.enabled && this.adapters.get(config.provider)?.configured,
    );
    const config = available ?? candidates[0];
    if (!config || !config.enabled) throw new AiProviderError('configuration', false);
    return config;
  }

  async availability(): Promise<Record<AiMode, boolean>> {
    const statuses = await this.providerStatus();
    const expertProviders =
      this.expertRouting.mode === 'fixed' && this.expertRouting.fixedProvider
        ? [this.expertRouting.fixedProvider]
        : this.expertRouting.order;
    return {
      expert: expertProviders.some((provider) => statusAvailable(statuses[provider])),
      fast: statusAvailable(statuses.gemini),
    };
  }

  async providerStatus(): Promise<Record<AiProviderName, AiProviderStatus>> {
    const now = this.now();
    const entries = await Promise.all(
      PROVIDERS.map(async (provider): Promise<[AiProviderName, AiProviderStatus]> => {
        const configured = Boolean(this.adapters.get(provider)?.configured);
        const enabled = [...this.models.values()].some(
          (model) => model.provider === provider && model.enabled,
        );
        if (!enabled) return [provider, { configured, enabled, state: 'MANUAL_PAUSED' }];
        try {
          const stored = await this.options.providerStateStore.getProviderState(provider);
          if (!stored) return [provider, { configured, enabled, state: 'ACTIVE' }];
          if (!stored.manualEnabled || stored.circuitState === 'MANUAL_PAUSED') {
            return [provider, { configured, enabled, state: 'MANUAL_PAUSED' }];
          }
          const pauseExpired =
            stored.pausedUntil === null || new Date(stored.pausedUntil).getTime() <= now.getTime();
          const state =
            stored.circuitState === 'OPEN' && pauseExpired ? 'HALF_OPEN' : stored.circuitState;
          return [provider, { configured, enabled, state }];
        } catch {
          return [provider, { configured, enabled, state: 'OPEN' }];
        }
      }),
    );
    return Object.fromEntries(entries) as Record<AiProviderName, AiProviderStatus>;
  }

  async execute(request: AiExecutionRequest): Promise<AiExecutionResult> {
    const configs = request.mode === 'fast' ? [this.fastModel] : this.expertConfigs();
    const autoFailover = request.mode === 'expert' && this.expertRouting.mode === 'auto';
    let lastError: AiProviderError | undefined;
    let attemptNumber = 0;
    let emitted = false;

    for (const config of configs) {
      const adapter = this.adapters.get(config.provider);
      if (!config.enabled || !adapter?.configured) {
        lastError = new AiProviderError('configuration', false);
        if (autoFailover) continue;
        throw lastError;
      }
      if (request.onDelta && (!config.supportsStreaming || !adapter.supportsStreaming)) {
        lastError = new AiProviderError('configuration', false);
        if (autoFailover) continue;
        throw lastError;
      }

      let acquired: Awaited<ReturnType<AiProviderStateStore['acquireProvider']>>;
      try {
        acquired = await this.options.providerStateStore.acquireProvider({
          halfOpenLeaseSeconds: this.options.circuitBreaker.halfOpenLeaseSeconds,
          now: this.now(),
          provider: config.provider,
        });
      } catch {
        throw new AiProviderError('unknown', false);
      }
      if (!acquired.allowed) {
        lastError = new AiProviderError('unavailable', false);
        if (autoFailover) continue;
        throw lastError;
      }

      let providerError: AiProviderError | undefined;
      for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
        attemptNumber += 1;
        const startedAt = this.now();
        const signal = attemptSignal(request.signal, this.options.timeoutMilliseconds);
        let response: AiProviderResponse | undefined;
        try {
          const providerRequest = {
            maxOutputTokens: config.maxOutputTokens,
            messages: request.messages,
            signal: signal.signal,
            systemPrompt: request.systemPrompt,
          };
          if (request.onDelta) {
            response = await adapter.stream(providerRequest, async (delta) => {
              if (delta) emitted = true;
              await request.onDelta?.(delta);
            });
          } else {
            response = await adapter.generate(providerRequest);
          }
        } catch (error) {
          providerError = normalizedError(error, signal, request.signal);
        } finally {
          signal.cleanup();
        }
        const completedAt = this.now();
        if (response) {
          await this.notifyAttempt(request, {
            attemptNumber,
            completedAt,
            inputTokens: response.usage.inputTokens,
            latencyMilliseconds: completedAt.getTime() - startedAt.getTime(),
            model: config.model,
            outputTokens: response.usage.outputTokens,
            provider: config.provider,
            startedAt,
            status: 'succeeded',
          });
          try {
            await this.options.providerStateStore.recordProviderSuccess({
              baseCooldownSeconds: this.options.circuitBreaker.cooldownSeconds,
              now: completedAt,
              provider: config.provider,
            });
          } catch {
            throw new AiProviderError('unknown', false);
          }
          return { ...response, config };
        }
        providerError ??= new AiProviderError('unknown', false);
        await this.notifyAttempt(request, {
          attemptNumber,
          completedAt,
          errorCategory: providerError.category,
          latencyMilliseconds: completedAt.getTime() - startedAt.getTime(),
          model: config.model,
          provider: config.provider,
          startedAt,
          status: emitted ? 'interrupted' : 'failed',
        });
        if (
          emitted ||
          !sameProviderRetryAllowed(providerError) ||
          attempt >= this.options.maxRetries ||
          request.signal?.aborted
        ) {
          break;
        }
        await this.wait(100 * (attempt + 1));
      }

      lastError = providerError ?? new AiProviderError('unknown', false);
      if (circuitRelevant(lastError.category)) {
        try {
          await this.options.providerStateStore.recordProviderFailure({
            baseCooldownSeconds: this.options.circuitBreaker.cooldownSeconds,
            category: lastError.category,
            failureThreshold: this.options.circuitBreaker.failureThreshold,
            failureWindowSeconds: this.options.circuitBreaker.failureWindowSeconds,
            maxCooldownSeconds: this.options.circuitBreaker.maxCooldownSeconds,
            now: this.now(),
            provider: config.provider,
            ...(lastError.retryAfterMilliseconds === undefined
              ? {}
              : { retryAfterSeconds: Math.ceil(lastError.retryAfterMilliseconds / 1_000) }),
          });
        } catch {
          throw new AiProviderError('unknown', false);
        }
      }
      if (!autoFailover || emitted || !failoverAllowed(lastError.category)) throw lastError;
    }

    throw lastError && lastError.category !== 'configuration'
      ? lastError
      : new AiProviderError('unavailable', false);
  }

  private expertConfigs(): AiModelConfig[] {
    const providers =
      this.expertRouting.mode === 'fixed' && this.expertRouting.fixedProvider
        ? [this.expertRouting.fixedProvider]
        : this.expertRouting.order;
    return providers
      .map((provider) => this.models.get(modelKey('expert', provider)))
      .filter((config): config is AiModelConfig => Boolean(config));
  }

  private async notifyAttempt(
    request: AiExecutionRequest,
    event: AiProviderAttemptEvent,
  ): Promise<void> {
    if (!request.onAttempt) return;
    try {
      await request.onAttempt(event);
    } catch {
      throw new AiProviderError('unknown', false);
    }
  }
}
