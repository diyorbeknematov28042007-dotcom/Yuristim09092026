import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

export interface PublicDatabaseConfig {
  publishableKey: string;
  url: string;
}

export interface ServerDatabaseConfig extends PublicDatabaseConfig {
  serviceRoleKey: string;
}

export function createServerDatabaseClient(
  config: Readonly<ServerDatabaseConfig>,
): SupabaseClient<Database> {
  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export const DB_PACKAGE_BOUNDARY = '@yuristim/db';
