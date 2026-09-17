import {
  AiGateway,
  AnthropicAdapter,
  GeminiAdapter,
  OpenAiAdapter,
  type AiModelConfig,
  type AiProviderName,
} from '@yuristim/ai';
import type { ApiEnv } from '../../config/env.js';

export function createAiGateway(env: ApiEnv, fetchImplementation?: typeof fetch): AiGateway {
  const expertProvider: AiProviderName =
    env.AI_EXPERT_PROVIDER ??
    (env.OPENAI_API_KEY ? 'openai' : env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');
  const expertModel =
    env.AI_EXPERT_MODEL ?? (expertProvider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-5.6-sol');
  const models: AiModelConfig[] = [
    {
      contextLimit: env.AI_FAST_CONTEXT_TOKENS,
      enabled: true,
      estimateOutputTokens: 384,
      inputCostPerMillionUsd: env.AI_FAST_INPUT_COST_PER_MILLION_USD,
      markupMultiplier: env.AI_MARKUP_MULTIPLIER,
      maxOutputTokens: env.AI_FAST_MAX_OUTPUT_TOKENS,
      mode: 'fast',
      model: env.AI_FAST_MODEL,
      outputCostPerMillionUsd: env.AI_FAST_OUTPUT_COST_PER_MILLION_USD,
      provider: 'gemini',
      supportsStreaming: true,
      usdPerCredit: env.AI_USD_PER_CREDIT,
    },
    {
      contextLimit: env.AI_EXPERT_CONTEXT_TOKENS,
      enabled: true,
      estimateOutputTokens: 1_024,
      inputCostPerMillionUsd: env.AI_EXPERT_INPUT_COST_PER_MILLION_USD ?? 2,
      markupMultiplier: env.AI_MARKUP_MULTIPLIER,
      maxOutputTokens: env.AI_EXPERT_MAX_OUTPUT_TOKENS,
      mode: 'expert',
      model: expertModel,
      outputCostPerMillionUsd: env.AI_EXPERT_OUTPUT_COST_PER_MILLION_USD ?? 10,
      provider: expertProvider,
      supportsStreaming: true,
      usdPerCredit: env.AI_USD_PER_CREDIT,
    },
  ];

  return new AiGateway({
    adapters: [
      new GeminiAdapter({
        apiKey: env.GEMINI_API_KEY,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
        model: env.AI_FAST_MODEL,
      }),
      new OpenAiAdapter({
        apiKey: env.OPENAI_API_KEY,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
        model: expertProvider === 'openai' ? expertModel : 'gpt-5.6-sol',
      }),
      new AnthropicAdapter({
        apiKey: env.ANTHROPIC_API_KEY,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
        model: expertProvider === 'anthropic' ? expertModel : 'claude-sonnet-5',
      }),
    ],
    maxRetries: env.AI_PROVIDER_MAX_RETRIES,
    models,
    timeoutMilliseconds: env.AI_PROVIDER_TIMEOUT_MILLISECONDS,
  });
}
