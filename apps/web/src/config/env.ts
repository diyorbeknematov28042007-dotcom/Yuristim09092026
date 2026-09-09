import { parseEnv } from '@yuristim/config';
import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
});

export const webEnv = parseEnv(publicEnvSchema, {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
