export type AiMode = 'fast' | 'expert';
export type AiProviderName = 'gemini' | 'openai' | 'anthropic';
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

export class AiProviderError extends Error {
  constructor(
    readonly category: AiProviderErrorCategory,
    readonly retryable: boolean,
    message = 'AI provider request failed',
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

export interface AiExecutionRequest {
  mode: AiMode;
  messages: AiProviderRequest['messages'];
  systemPrompt: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void | Promise<void>;
}

export interface AiExecutionResult extends AiProviderResponse {
  config: AiModelConfig;
}
