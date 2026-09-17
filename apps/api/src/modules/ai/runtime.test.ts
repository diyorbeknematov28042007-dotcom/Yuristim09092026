import { InMemoryAiProviderStateStore } from '@yuristim/ai';
import { describe, expect, it } from 'vitest';
import { loadApiEnv } from '../../config/env.js';
import { createAiGateway } from './runtime.js';

const base = {
  INTERNAL_BOT_API_SECRET: 'i'.repeat(32),
  NODE_ENV: 'test',
  PAYMENT_WEBHOOK_SECRET: 'p'.repeat(32),
  SESSION_SECRET: 's'.repeat(32),
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_URL: 'https://example.supabase.co',
};

function gateway(overrides: Record<string, string | undefined>) {
  return createAiGateway(loadApiEnv({ ...base, ...overrides }), new InMemoryAiProviderStateStore());
}

describe('AI runtime provider model mapping', () => {
  it('maps Fast to Gemini 3.8 Flash only', () => {
    const config = gateway({ GEMINI_API_KEY: 'configured' }).config('fast');
    expect(config).toMatchObject({ model: 'gemini-3.8-flash', provider: 'gemini' });
  });

  it.each([
    ['bai', 'BAI_API_KEY', 'DeepSeek-V4.1-Flash'],
    ['openai', 'OPENAI_API_KEY', 'gpt-5.6-sol'],
    ['anthropic', 'ANTHROPIC_API_KEY', 'claude-opus-5'],
  ] as const)('maps fixed %s to its production model', (provider, key, expectedModel) => {
    const config = gateway({
      AI_EXPERT_PROVIDER: provider,
      AI_EXPERT_PROVIDER_MODE: 'fixed',
      [key]: 'configured',
    }).config('expert');
    expect(config).toMatchObject({ model: expectedModel, provider });
  });

  it('keeps a missing fixed credential unavailable without provider fallback', async () => {
    const ai = gateway({
      AI_EXPERT_PROVIDER: 'bai',
      AI_EXPERT_PROVIDER_MODE: 'fixed',
      OPENAI_API_KEY: 'configured',
    });
    await expect(
      ai.execute({
        messages: [{ content: 'Savol', role: 'user' }],
        mode: 'expert',
        systemPrompt: 'Policy',
      }),
    ).rejects.toMatchObject({ category: 'configuration' });
  });

  it('marks Fast unavailable when Gemini has no credential and never uses Expert', async () => {
    const ai = gateway({ OPENAI_API_KEY: 'configured' });
    await expect(ai.availability()).resolves.toMatchObject({ expert: true, fast: false });
    await expect(
      ai.execute({
        messages: [{ content: 'Savol', role: 'user' }],
        mode: 'fast',
        systemPrompt: 'Policy',
      }),
    ).rejects.toMatchObject({ category: 'configuration' });
  });
});
