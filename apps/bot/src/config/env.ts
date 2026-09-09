import { nodeEnvSchema, parseEnv } from '@yuristim/config';
import { z } from 'zod';

const botEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
});

export type BotEnv = z.infer<typeof botEnvSchema>;

export function loadBotEnv(source: Record<string, string | undefined> = process.env): BotEnv {
  return parseEnv(botEnvSchema, source);
}
