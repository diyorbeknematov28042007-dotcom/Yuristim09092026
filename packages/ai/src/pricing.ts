import type { AiModelConfig, AiUsage } from './types.js';

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateProviderCostUsd(config: AiModelConfig, usage: AiUsage): number {
  const inputCost = (nonNegative(usage.inputTokens) / 1_000_000) * config.inputCostPerMillionUsd;
  const outputCost = (nonNegative(usage.outputTokens) / 1_000_000) * config.outputCostPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(8));
}

export function calculateCreditCharge(config: AiModelConfig, usage: AiUsage): number {
  const providerCost = calculateProviderCostUsd(config, usage);
  const rawCredits = (providerCost * config.markupMultiplier) / config.usdPerCredit;
  return Math.max(1, Math.ceil(rawCredits * 1_000) / 1_000);
}

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(value).byteLength / 4));
}

export function estimateCreditCharge(
  config: AiModelConfig,
  messages: Array<{ content: string }>,
  systemPrompt: string,
): { credits: number; estimatedInputTokens: number; estimatedOutputTokens: number } {
  const estimatedInputTokens =
    estimateTokens(systemPrompt) +
    messages.reduce((total, message) => total + estimateTokens(message.content), 0);
  const estimatedOutputTokens = config.estimateOutputTokens;
  return {
    credits: calculateCreditCharge(config, {
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
    }),
    estimatedInputTokens,
    estimatedOutputTokens,
  };
}
