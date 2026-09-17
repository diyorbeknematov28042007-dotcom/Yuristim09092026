import {
  createServerDatabaseClient,
  SupabaseAiRepository,
  SupabaseCoreRepository,
  SupabaseFinanceRepository,
  SupabaseLawyerRepository,
  SupabaseMarketplaceRepository,
} from '@yuristim/db';
import { buildApp } from './app.js';
import { loadApiEnv } from './config/env.js';
import { AdminService } from './modules/admin/service.js';
import { CoreAuthService } from './modules/auth/service.js';
import { CreditService } from './modules/credits/service.js';
import { LawyerService } from './modules/lawyers/service.js';
import { PaymentService, SandboxPaymentAdapter } from './modules/payments/service.js';
import { MarketplaceService } from './modules/marketplace/service.js';
import { createAiGateway } from './modules/ai/runtime.js';
import { AiService } from './modules/ai/service.js';

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
const financeRepository = new SupabaseFinanceRepository(databaseClient);
const marketplaceService = new MarketplaceService(
  new SupabaseMarketplaceRepository(databaseClient),
);
const creditService = new CreditService(financeRepository);
const aiRepository = new SupabaseAiRepository(databaseClient);
const aiService = new AiService(aiRepository, createAiGateway(env, aiRepository), creditService);
const paymentService = new PaymentService(
  financeRepository,
  new SandboxPaymentAdapter(env.PAYMENT_WEBHOOK_SECRET),
);
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
    creditService,
    paymentService,
    marketplaceService,
    aiService,
  },
  logger: {
    level: env.LOG_LEVEL,
  },
});

let weeklyCreditTimer: NodeJS.Timeout | undefined;

async function runWeeklyCreditGrant(): Promise<void> {
  try {
    const granted = await creditService.grantWeekly();
    app.log.info({ granted }, 'Weekly credit grant completed');
  } catch (error) {
    app.log.error({ err: error }, 'Weekly credit grant failed');
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  if (weeklyCreditTimer) clearInterval(weeklyCreditTimer);
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
  await runWeeklyCreditGrant();
  weeklyCreditTimer = setInterval(
    () => void runWeeklyCreditGrant(),
    env.WEEKLY_CREDIT_JOB_INTERVAL_SECONDS * 1_000,
  );
  weeklyCreditTimer.unref();
} catch (error) {
  app.log.error({ err: error }, 'API failed to start');
  process.exitCode = 1;
}
