import { describe, expect, it } from 'vitest';
import { loadApiEnv } from './env.js';

const base = {
  INTERNAL_BOT_API_SECRET: 'i'.repeat(32),
  NODE_ENV: 'test',
  PAYMENT_WEBHOOK_SECRET: 'p'.repeat(32),
  SESSION_SECRET: 's'.repeat(32),
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_URL: 'https://example.supabase.co',
};

describe('AI provider environment configuration', () => {
  it('uses production model, reasoning, routing, and circuit defaults without requiring keys', () => {
    const env = loadApiEnv(base);
    expect(env).toMatchObject({
      AI_EXPERT_PROVIDER_MODE: 'auto',
      AI_EXPERT_PROVIDER_ORDER: ['bai', 'openai', 'anthropic'],
      AI_PROVIDER_ANTHROPIC_ENABLED: true,
      AI_PROVIDER_BAI_ENABLED: true,
      AI_PROVIDER_COOLDOWN_SECONDS: 300,
      AI_PROVIDER_FAILURE_THRESHOLD: 3,
      AI_PROVIDER_FAILURE_WINDOW_SECONDS: 120,
      AI_PROVIDER_GEMINI_ENABLED: true,
      AI_PROVIDER_MAX_COOLDOWN_SECONDS: 1_800,
      AI_PROVIDER_OPENAI_ENABLED: true,
      ANTHROPIC_EFFORT: 'high',
      BAI_BASE_URL: 'https://api.b.ai/v1',
      BAI_REASONING_EFFORT: 'high',
      GEMINI_THINKING_LEVEL: 'low',
      OPENAI_REASONING_EFFORT: 'high',
    });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.BAI_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('parses manual fixed routing and provider kill switches', () => {
    const env = loadApiEnv({
      ...base,
      AI_EXPERT_PROVIDER: 'openai',
      AI_EXPERT_PROVIDER_MODE: 'fixed',
      AI_PROVIDER_BAI_ENABLED: 'false',
    });
    expect(env.AI_EXPERT_PROVIDER).toBe('openai');
    expect(env.AI_PROVIDER_BAI_ENABLED).toBe(false);
  });

  it('keeps the legacy AI_EXPERT_PROVIDER variable fixed when mode is omitted', () => {
    const env = loadApiEnv({ ...base, AI_EXPERT_PROVIDER: 'anthropic' });
    expect(env.AI_EXPERT_PROVIDER_MODE).toBe('fixed');
  });

  it('rejects duplicate/unknown AUTO order and fixed mode without a provider', () => {
    expect(() => loadApiEnv({ ...base, AI_EXPERT_PROVIDER_ORDER: 'bai,bai' })).toThrow();
    expect(() => loadApiEnv({ ...base, AI_EXPERT_PROVIDER_MODE: 'fixed' })).toThrow();
  });
});
