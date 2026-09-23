import {
  createServerDatabaseClient,
  SupabaseCoreRepository,
  SupabaseLawyerRepository,
} from '@yuristim/db';
import { buildApp } from './app.js';
import { loadApiEnv } from './config/env.js';
import { AdminService } from './modules/admin/service.js';
import { CoreAuthService } from './modules/auth/service.js';
import { LawyerService } from './modules/lawyers/service.js';

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
const lawyerRepository = new SupabaseLawyerRepository(databaseClient);
const lawyerService = new LawyerService(lawyerRepository);
const adminService = new AdminService(lawyerRepository, {
  sessionSecret: env.SESSION_SECRET,
  sessionTtlSeconds: env.ADMIN_SESSION_TTL_SECONDS,
});
await adminService.bootstrap(env.ADMIN_BOOTSTRAP_USERNAME, env.ADMIN_BOOTSTRAP_PASSWORD);
const app = buildApp({
  core: {
    adminService,
    internalBotSecret: env.INTERNAL_BOT_API_SECRET,
    production: env.NODE_ENV === 'production',
    service: authService,
    lawyerService,
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
