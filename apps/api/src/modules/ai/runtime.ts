import {
  AiGateway,
  AnthropicAdapter,
  BaiAdapter,
  GeminiAdapter,
  OpenAiAdapter,
  type AiExpertProviderName,
  type AiModelConfig,
  type AiProviderStateStore,
} from '@yuristim/ai';
import type { ApiEnv } from '../../config/env.js';

function expertModel(
  env: ApiEnv,
  provider: AiExpertProviderName,
  configuredModel: string | undefined,
  fallback: string,
): string {
  if (configuredModel) return configuredModel;
  if (
    env.AI_EXPERT_PROVIDER_MODE === 'fixed' &&
    env.AI_EXPERT_PROVIDER === provider &&
    env.AI_EXPERT_MODEL
  ) {
    return env.AI_EXPERT_MODEL;
  }
  return fallback;
}

export function createAiGateway(
  env: ApiEnv,
  providerStateStore: AiProviderStateStore,
  fetchImplementation?: typeof fetch,
): AiGateway {
  const geminiModel = env.GEMINI_MODEL ?? env.AI_FAST_MODEL ?? 'gemini-3.8-flash';
  const baiModel = expertModel(env, 'bai', env.BAI_MODEL, 'deepseek-v4.1-flash');
  const openAiModel = expertModel(env, 'openai', env.OPENAI_MODEL, 'gpt-5.6-sol');
  const anthropicModel = expertModel(env, 'anthropic', env.ANTHROPIC_MODEL, 'claude-opus-5');
  const expertPricing = {
    inputCostPerMillionUsd: env.AI_EXPERT_INPUT_COST_PER_MILLION_USD ?? 2,
    outputCostPerMillionUsd: env.AI_EXPERT_OUTPUT_COST_PER_MILLION_USD ?? 10,
  };
  const expertConfig = (
    provider: AiExpertProviderName,
    model: string,
    enabled: boolean,
  ): AiModelConfig => ({
    contextLimit: env.AI_EXPERT_CONTEXT_TOKENS,
    enabled,
    estimateOutputTokens: 1_024,
    ...expertPricing,
    markupMultiplier: env.AI_MARKUP_MULTIPLIER,
    maxOutputTokens: env.AI_EXPERT_MAX_OUTPUT_TOKENS,
    mode: 'expert',
    model,
    provider,
    supportsStreaming: true,
    usdPerCredit: env.AI_USD_PER_CREDIT,
  });
  const models: AiModelConfig[] = [
    {
      contextLimit: env.AI_FAST_CONTEXT_TOKENS,
      enabled: env.AI_PROVIDER_GEMINI_ENABLED,
      estimateOutputTokens: 384,
      inputCostPerMillionUsd: env.AI_FAST_INPUT_COST_PER_MILLION_USD,
      markupMultiplier: env.AI_MARKUP_MULTIPLIER,
      maxOutputTokens: env.AI_FAST_MAX_OUTPUT_TOKENS,
      mode: 'fast',
      model: geminiModel,
      outputCostPerMillionUsd: env.AI_FAST_OUTPUT_COST_PER_MILLION_USD,
      provider: 'gemini',
      supportsStreaming: true,
      usdPerCredit: env.AI_USD_PER_CREDIT,
    },
    expertConfig('bai', baiModel, env.AI_PROVIDER_BAI_ENABLED),
    expertConfig('openai', openAiModel, env.AI_PROVIDER_OPENAI_ENABLED),
    expertConfig('anthropic', anthropicModel, env.AI_PROVIDER_ANTHROPIC_ENABLED),
  ];

  return new AiGateway({
    adapters: [
      new GeminiAdapter({
        apiKey: env.GEMINI_API_KEY,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
        model: geminiModel,
        thinkingLevel: env.GEMINI_THINKING_LEVEL,
      }),
      new BaiAdapter({
        apiKey: env.BAI_API_KEY,
        baseUrl: env.BAI_BASE_URL,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
        model: baiModel,
        reasoningEffort: env.BAI_REASONING_EFFORT,
      }),
      new OpenAiAdapter({
        apiKey: env.OPENAI_API_KEY,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
        model: openAiModel,
        reasoningEffort: env.OPENAI_REASONING_EFFORT,
      }),
      new AnthropicAdapter({
        apiKey: env.ANTHROPIC_API_KEY,
        effort: env.ANTHROPIC_EFFORT,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
        model: anthropicModel,
      }),
    ],
    circuitBreaker: {
      cooldownSeconds: env.AI_PROVIDER_COOLDOWN_SECONDS,
      failureThreshold: env.AI_PROVIDER_FAILURE_THRESHOLD,
      failureWindowSeconds: env.AI_PROVIDER_FAILURE_WINDOW_SECONDS,
      halfOpenLeaseSeconds: Math.ceil(env.AI_GATEWAY_TIMEOUT_MILLISECONDS / 1_000) + 5,
      maxCooldownSeconds: env.AI_PROVIDER_MAX_COOLDOWN_SECONDS,
    },
    expertRouting: {
      ...(env.AI_EXPERT_PROVIDER ? { fixedProvider: env.AI_EXPERT_PROVIDER } : {}),
      mode: env.AI_EXPERT_PROVIDER_MODE,
      order: env.AI_EXPERT_PROVIDER_ORDER,
    },
    maxRetries: env.AI_PROVIDER_MAX_RETRIES,
    models,
    providerStateStore,
    timeoutMilliseconds: env.AI_PROVIDER_TIMEOUT_MILLISECONDS,
    totalTimeoutMilliseconds: env.AI_GATEWAY_TIMEOUT_MILLISECONDS,
  });
}
