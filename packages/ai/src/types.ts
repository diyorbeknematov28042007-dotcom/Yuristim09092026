export type AiMode = 'fast' | 'expert';
export type AiProviderName = 'gemini' | 'bai' | 'openai' | 'anthropic';
export type AiExpertProviderName = Exclude<AiProviderName, 'gemini'>;
export type AiReasoningEffort = 'low' | 'medium' | 'high';
export type AiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
export type AiProviderCircuitState = 'ACTIVE' | 'OPEN' | 'HALF_OPEN' | 'MANUAL_PAUSED';
export type AiMessageRole = 'user' | 'assistant';

export interface AiContextMessage {
  role: AiMessageRole;
  content: string;
  createdAt: string;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiProviderRequest {
  systemPrompt: string;
  messages: Array<Pick<AiContextMessage, 'role' | 'content'>>;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface AiProviderResponse {
  content: string;
  usage: AiUsage;
}

export type AiProviderErrorCategory =
  | 'timeout'
  | 'rate_limit'
  | 'unavailable'
  | 'invalid_request'
  | 'configuration'
  | 'cancelled'
  | 'unknown';

export interface AiProviderDiagnostics {
  provider?: AiProviderName;
  model?: string;
  statusCode?: number | undefined;
  reason?:
    | 'http_error'
    | 'network_error'
    | 'malformed_response'
    | 'empty_response'
    | 'invalid_usage'
    | 'circuit_open'
    | 'request_budget'
    | undefined;
}

export class AiProviderError extends Error {
  constructor(
    readonly category: AiProviderErrorCategory,
    readonly retryable: boolean,
    message = 'AI provider request failed',
    readonly retryAfterMilliseconds?: number | undefined,
    readonly diagnostics: AiProviderDiagnostics = {},
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiProviderAdapter {
  readonly name: AiProviderName;
  readonly configured: boolean;
  readonly supportsStreaming: boolean;
  generate(request: AiProviderRequest): Promise<AiProviderResponse>;
  stream(
    request: AiProviderRequest,
    onDelta: (delta: string) => void | Promise<void>,
  ): Promise<AiProviderResponse>;
}

export interface AiModelConfig {
  provider: AiProviderName;
  model: string;
  mode: AiMode;
  enabled: boolean;
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
  markupMultiplier: number;
  usdPerCredit: number;
  contextLimit: number;
  maxOutputTokens: number;
  estimateOutputTokens: number;
  supportsStreaming: boolean;
}

export interface AiProviderRuntimeState {
  provider: AiProviderName;
  manualEnabled: boolean;
  circuitState: AiProviderCircuitState;
  consecutiveFailures: number;
  failureWindowStartedAt: string | null;
  pausedUntil: string | null;
  cooldownSeconds: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCategory: AiProviderErrorCategory | null;
}

export interface AiProviderStateStore {
  getProviderState(provider: AiProviderName): Promise<AiProviderRuntimeState | null>;
  acquireProvider(input: {
    provider: AiProviderName;
    now: Date;
    halfOpenLeaseSeconds: number;
  }): Promise<{ allowed: boolean; state: AiProviderRuntimeState }>;
  recordProviderSuccess(input: {
    provider: AiProviderName;
    now: Date;
    baseCooldownSeconds: number;
  }): Promise<AiProviderRuntimeState>;
  recordProviderFailure(input: {
    provider: AiProviderName;
    category: AiProviderErrorCategory;
    now: Date;
    failureThreshold: number;
    failureWindowSeconds: number;
    baseCooldownSeconds: number;
    maxCooldownSeconds: number;
    retryAfterSeconds?: number | undefined;
  }): Promise<AiProviderRuntimeState>;
}

export interface AiProviderAttemptEvent {
  attemptNumber: number;
  provider: AiProviderName;
  model: string;
  status: 'succeeded' | 'failed' | 'interrupted';
  errorCategory?: AiProviderErrorCategory | undefined;
  statusCode?: number | undefined;
  errorReason?: AiProviderDiagnostics['reason'];
  latencyMilliseconds: number;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  startedAt: Date;
  completedAt: Date;
}

export interface AiExpertRoutingConfig {
  mode: 'auto' | 'fixed';
  order: AiExpertProviderName[];
  fixedProvider?: AiExpertProviderName | undefined;
}

export interface AiCircuitBreakerConfig {
  failureThreshold: number;
  failureWindowSeconds: number;
  cooldownSeconds: number;
  maxCooldownSeconds: number;
  halfOpenLeaseSeconds: number;
}

export interface AiProviderStatus {
  configured: boolean;
  enabled: boolean;
  state: AiProviderCircuitState;
}

export interface AiDependencyDiagnostic {
  operation: 'acquire_provider' | 'record_success' | 'record_failure' | 'record_attempt';
  provider: AiProviderName;
  attemptNumber?: number;
}

export interface AiExecutionRequest {
  mode: AiMode;
  messages: AiProviderRequest['messages'];
  systemPrompt: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void | Promise<void>;
  onAttempt?: (event: AiProviderAttemptEvent) => void | Promise<void>;
  onDiagnostic?: (event: AiDependencyDiagnostic) => void;
}

export interface AiExecutionResult extends AiProviderResponse {
  config: AiModelConfig;
}
