import { DEFAULT_API_PORT, nodeEnvSchema, parseEnv } from '@yuristim/config';
import { z } from 'zod';

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
  })
  .refine(
    (value) => Boolean(value.ADMIN_BOOTSTRAP_USERNAME) === Boolean(value.ADMIN_BOOTSTRAP_PASSWORD),
    { message: 'Admin bootstrap username and password must be configured together' },
  );

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}
