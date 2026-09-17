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
  z.enum(['openai', 'anthropic']).optional(),
);
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
    OPENAI_API_KEY: optionalSecret,
    ANTHROPIC_API_KEY: optionalSecret,
    AI_FAST_MODEL: z.string().min(1).max(120).default('gemini-3.5-flash-lite'),
    AI_EXPERT_PROVIDER: optionalExpertProvider,
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
    AI_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
    AI_FAST_CONTEXT_TOKENS: z.coerce.number().int().min(4_096).max(262_144).default(32_768),
    AI_EXPERT_CONTEXT_TOKENS: z.coerce.number().int().min(4_096).max(262_144).default(65_536),
    AI_FAST_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16_384).default(2_048),
    AI_EXPERT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_768).default(4_096),
  })
  .refine(
    (value) => Boolean(value.ADMIN_BOOTSTRAP_USERNAME) === Boolean(value.ADMIN_BOOTSTRAP_PASSWORD),
    { message: 'Admin bootstrap username and password must be configured together' },
  );

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}
