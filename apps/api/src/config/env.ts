import { DEFAULT_API_PORT, nodeEnvSchema, parseEnv } from '@yuristim/config';
import { z } from 'zod';

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalModel = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).max(120).optional(),
);
const optionalExpertProvider = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.enum(['bai', 'openai', 'anthropic']).optional(),
);
const providerReasoningEffort = z.enum(['low', 'medium', 'high']);
const geminiThinkingLevel = z.enum(['minimal', 'low', 'medium', 'high']);
const optionalBoolean = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
);
const providerOrder = z
  .string()
  .min(1)
  .default('bai,openai,anthropic')
  .transform((value, context) => {
    const providers = value.split(',').map((provider) => provider.trim());
    const valid = providers.every((provider) => ['bai', 'openai', 'anthropic'].includes(provider));
    if (!valid || new Set(providers).size !== providers.length) {
      context.addIssue({ code: 'custom', message: 'Invalid or duplicate Expert provider order' });
      return z.NEVER;
    }
    return providers as Array<'bai' | 'openai' | 'anthropic'>;
  });
const optionalPositiveNumber = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce.number().positive().optional(),
);

const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_API_PORT),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    INTERNAL_BOT_API_SECRET: z.string().min(32),
    PAYMENT_WEBHOOK_SECRET: z.string().min(32),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(31_536_000).default(2_592_000),
    LOGIN_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(600),
    ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
    WEEKLY_CREDIT_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
    ADMIN_BOOTSTRAP_USERNAME: z.string().trim().min(3).max(64).optional(),
    ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).max(256).optional(),
    GEMINI_API_KEY: optionalSecret,
    BAI_API_KEY: optionalSecret,
    OPENAI_API_KEY: optionalSecret,
    ANTHROPIC_API_KEY: optionalSecret,
    GEMINI_MODEL: optionalModel,
    GEMINI_THINKING_LEVEL: geminiThinkingLevel.default('low'),
    BAI_BASE_URL: z.string().url().default('https://api.b.ai/v1'),
    BAI_MODEL: optionalModel,
    BAI_REASONING_EFFORT: providerReasoningEffort.default('high'),
    OPENAI_MODEL: optionalModel,
    OPENAI_REASONING_EFFORT: providerReasoningEffort.default('high'),
    ANTHROPIC_MODEL: optionalModel,
    ANTHROPIC_EFFORT: providerReasoningEffort.default('high'),
    AI_EXPERT_PROVIDER_MODE: z.enum(['auto', 'fixed']).default('auto'),
    AI_EXPERT_PROVIDER_ORDER: providerOrder,
    AI_EXPERT_PROVIDER: optionalExpertProvider,
    AI_PROVIDER_GEMINI_ENABLED: optionalBoolean.default(true),
    AI_PROVIDER_BAI_ENABLED: optionalBoolean.default(true),
    AI_PROVIDER_OPENAI_ENABLED: optionalBoolean.default(true),
    AI_PROVIDER_ANTHROPIC_ENABLED: optionalBoolean.default(true),
    AI_PROVIDER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
    AI_PROVIDER_FAILURE_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3_600).default(120),
    AI_PROVIDER_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(86_400).default(300),
    AI_PROVIDER_MAX_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(86_400).default(1_800),
    // Backward-compatible aliases. New deployments should use provider-specific variables.
    AI_FAST_MODEL: optionalModel,
    AI_EXPERT_MODEL: optionalModel,
    AI_FAST_INPUT_COST_PER_MILLION_USD: z.coerce.number().positive().default(0.3),
    AI_FAST_OUTPUT_COST_PER_MILLION_USD: z.coerce.number().positive().default(2.5),
    AI_EXPERT_INPUT_COST_PER_MILLION_USD: optionalPositiveNumber,
    AI_EXPERT_OUTPUT_COST_PER_MILLION_USD: optionalPositiveNumber,
    AI_MARKUP_MULTIPLIER: z.coerce.number().min(1).max(100).default(1.5),
    AI_USD_PER_CREDIT: z.coerce.number().positive().max(1).default(0.002),
    AI_PROVIDER_TIMEOUT_MILLISECONDS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(120_000)
      .default(45_000),
    AI_GATEWAY_TIMEOUT_MILLISECONDS: z.coerce.number().int().min(5_000).max(90_000).default(90_000),
    AI_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
    AI_FAST_CONTEXT_TOKENS: z.coerce.number().int().min(4_096).max(262_144).default(32_768),
    AI_EXPERT_CONTEXT_TOKENS: z.coerce.number().int().min(4_096).max(262_144).default(65_536),
    AI_FAST_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16_384).default(2_048),
    AI_EXPERT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_768).default(4_096),
  })
  .refine(
    (value) => Boolean(value.ADMIN_BOOTSTRAP_USERNAME) === Boolean(value.ADMIN_BOOTSTRAP_PASSWORD),
    { message: 'Admin bootstrap username and password must be configured together' },
  )
  .refine(
    (value) => value.AI_EXPERT_PROVIDER_MODE !== 'fixed' || Boolean(value.AI_EXPERT_PROVIDER),
    {
      message: 'AI_EXPERT_PROVIDER is required when AI_EXPERT_PROVIDER_MODE=fixed',
      path: ['AI_EXPERT_PROVIDER'],
    },
  )
  .refine((value) => value.AI_PROVIDER_MAX_COOLDOWN_SECONDS >= value.AI_PROVIDER_COOLDOWN_SECONDS, {
    message: 'Maximum provider cooldown cannot be shorter than the base cooldown',
    path: ['AI_PROVIDER_MAX_COOLDOWN_SECONDS'],
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const parsed = parseEnv(apiEnvSchema, source);
  // Phase 7 backward compatibility: AI_EXPERT_PROVIDER previously meant fixed routing.
  if (source.AI_EXPERT_PROVIDER_MODE === undefined && parsed.AI_EXPERT_PROVIDER) {
    return { ...parsed, AI_EXPERT_PROVIDER_MODE: 'fixed' };
  }
  return parsed;
}
