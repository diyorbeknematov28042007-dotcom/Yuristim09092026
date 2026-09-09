import { createServerDatabaseClient, SupabaseCoreRepository } from '@yuristim/db';
import { buildApp } from './app.js';
import { loadApiEnv } from './config/env.js';
import { CoreAuthService } from './modules/auth/service.js';

const env = loadApiEnv();
const databaseClient = createServerDatabaseClient({
  publishableKey: env.SUPABASE_ANON_KEY,
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  url: env.SUPABASE_URL,
});
const authService = new CoreAuthService(new SupabaseCoreRepository(databaseClient), {
  challengeTtlSeconds: env.LOGIN_CHALLENGE_TTL_SECONDS,
  sessionSecret: env.SESSION_SECRET,
  sessionTtlSeconds: env.SESSION_TTL_SECONDS,
});
const app = buildApp({
  core: {
    internalBotSecret: env.INTERNAL_BOT_API_SECRET,
    production: env.NODE_ENV === 'production',
    service: authService,
  },
  logger: {
    level: env.LOG_LEVEL,
  },
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT,
  });
} catch (error) {
  app.log.error({ err: error }, 'API failed to start');
  process.exitCode = 1;
}
