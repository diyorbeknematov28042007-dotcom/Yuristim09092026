import { nodeEnvSchema, parseEnv } from '@yuristim/config';
import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);
const optionalUsername = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .regex(/^[A-Za-z0-9_]{5,32}$/)
    .optional(),
);
const optionalTelegramFileId = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).max(512).optional(),
);

const botEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  MARKETPLACE_CHANNEL_ID: z.coerce.number().int().negative().safe(),
  MARKETPLACE_CHANNEL_URL: z.string().url(),
  ADMIN_TELEGRAM_ID: z.coerce.number().int().positive().safe(),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_BOT_API_SECRET: z.string().min(32),
  PUBLIC_OFFER_URL: optionalUrl,
  PRIVACY_URL: optionalUrl,
  SUPPORT_USERNAME: optionalUsername,
  MINI_APP_URL: optionalUrl,
  TERMS_VERSION: z.string().min(1).max(64).default('2026-09'),
  API_TIMEOUT_MILLISECONDS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  AI_API_TIMEOUT_MILLISECONDS: z.coerce.number().int().min(5_000).max(120_000).default(60_000),
  TELEGRAM_AI_FAST_STICKER_FILE_ID: optionalTelegramFileId,
  TELEGRAM_AI_EXPERT_STICKER_FILE_ID: optionalTelegramFileId,
  TELEGRAM_AI_DOCUMENT_STICKER_FILE_ID: optionalTelegramFileId,
});

export type BotEnv = z.infer<typeof botEnvSchema>;

export function loadBotEnv(source: Record<string, string | undefined> = process.env): BotEnv {
  return parseEnv(botEnvSchema, source);
}
