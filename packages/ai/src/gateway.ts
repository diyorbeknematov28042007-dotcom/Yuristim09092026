import {
  AiProviderError,
  type AiExecutionRequest,
  type AiExecutionResult,
  type AiMode,
  type AiModelConfig,
  type AiProviderAdapter,
  type AiProviderName,
  type AiProviderResponse,
} from './types.js';

interface AiGatewayOptions {
  adapters: AiProviderAdapter[];
  models: AiModelConfig[];
  timeoutMilliseconds: number;
  maxRetries: number;
  wait?: (milliseconds: number) => Promise<void>;
}

interface AttemptSignal {
  signal: AbortSignal;
  cleanup(): void;
  timedOut(): boolean;
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
  return new AiProviderError('unknown', false);
}

export class AiGateway {
  private readonly adapters: Map<AiProviderName, AiProviderAdapter>;
  private readonly models: Map<AiMode, AiModelConfig>;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: AiGatewayOptions) {
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.name, adapter]));
    this.models = new Map(options.models.map((model) => [model.mode, model]));
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const fast = this.models.get('fast');
    if (!fast || fast.provider !== 'gemini') {
      throw new Error('Fast AI mode must be configured with Gemini only');
    }
  }

  config(mode: AiMode): AiModelConfig {
    const config = this.models.get(mode);
    if (!config || !config.enabled) throw new AiProviderError('configuration', false);
    return config;
  }

  availability(): Record<AiMode, boolean> {
    return {
      expert: this.isAvailable('expert'),
      fast: this.isAvailable('fast'),
    };
  }

  async execute(request: AiExecutionRequest): Promise<AiExecutionResult> {
    const config = this.config(request.mode);
    const adapter = this.adapters.get(config.provider);
    if (!adapter?.configured) throw new AiProviderError('configuration', false);
    if (request.onDelta && (!config.supportsStreaming || !adapter.supportsStreaming)) {
      throw new AiProviderError('configuration', false);
    }

    let emitted = false;
    let lastError: AiProviderError | undefined;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const attemptController = attemptSignal(request.signal, this.options.timeoutMilliseconds);
      try {
        const providerRequest = {
          maxOutputTokens: config.maxOutputTokens,
          messages: request.messages,
          signal: attemptController.signal,
          systemPrompt: request.systemPrompt,
        };
        let response: AiProviderResponse;
        if (request.onDelta) {
          response = await adapter.stream(providerRequest, async (delta) => {
            emitted = true;
            await request.onDelta?.(delta);
          });
        } else {
          response = await adapter.generate(providerRequest);
        }
        return { ...response, config };
      } catch (error) {
        lastError = normalizedError(error, attemptController, request.signal);
        if (
          emitted ||
          !lastError.retryable ||
          attempt >= this.options.maxRetries ||
          request.signal?.aborted
        ) {
          throw lastError;
        }
        await this.wait(100 * (attempt + 1));
      } finally {
        attemptController.cleanup();
      }
    }
    throw lastError ?? new AiProviderError('unknown', false);
  }

  private isAvailable(mode: AiMode): boolean {
    try {
      const config = this.config(mode);
      return Boolean(this.adapters.get(config.provider)?.configured);
    } catch {
      return false;
    }
  }
}
