import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
  type RawServerDefault,
} from 'fastify';
import { registerErrorHandler } from './lib/errors.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import type { AdminService } from './modules/admin/service.js';
import { registerAiRoutes } from './modules/ai/routes.js';
import type { AiService } from './modules/ai/service.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import type { CoreAuthService } from './modules/auth/service.js';
import { registerCreditRoutes } from './modules/credits/routes.js';
import type { CreditService } from './modules/credits/service.js';
import { registerFounding100Routes } from './modules/founding100/routes.js';
import type { Founding100Service } from './modules/founding100/service.js';
import { registerInternalRoutes } from './modules/internal/routes.js';
import { registerLawyerRoutes } from './modules/lawyers/routes.js';
import type { LawyerService } from './modules/lawyers/service.js';
import { registerMarketplaceRoutes } from './modules/marketplace/routes.js';
import type { MarketplaceService } from './modules/marketplace/service.js';
import { registerPaymentRoutes } from './modules/payments/routes.js';
import type { PaymentService } from './modules/payments/service.js';
import { registerUserRoutes } from './modules/users/routes.js';
import { registerRequestContext } from './plugins/request-context.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  core?: {
    internalBotSecret: string;
    production: boolean;
    service: CoreAuthService;
    lawyerService?: LawyerService;
    adminService?: AdminService;
    creditService?: CreditService;
    paymentService?: PaymentService;
    marketplaceService?: MarketplaceService;
    aiService?: AiService;
    founding100Service?: Founding100Service;
  };
  logger?: FastifyServerOptions<RawServerDefault>['logger'];
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    bodyLimit: 7_500_000,
    disableRequestLogging: true,
    logger: options.logger ?? {
      level: 'info',
    },
    requestIdHeader: 'x-request-id',
    genReqId(request) {
      const requestId = request.headers['x-request-id'];
      return typeof requestId === 'string' && requestId.length > 0 ? requestId : randomUUID();
    },
  });

  registerRequestContext(app);
  registerErrorHandler(app);

  app.register(async (healthApp) => {
    await healthRoutes(
      healthApp,
      options.core?.aiService
        ? options.core.aiService.availability.bind(options.core.aiService)
        : undefined,
    );
  });

  if (options.core) {
    const core = options.core;
    app.register(async (coreApp) => {
      await coreApp.register(cookie);
      registerAuthRoutes(coreApp, {
        production: core.production,
        service: core.service,
      });
      registerUserRoutes(coreApp, core.service);
      if (core.creditService) {
        registerCreditRoutes(coreApp, { auth: core.service, credits: core.creditService });
      }
      if (core.aiService) {
        registerAiRoutes(coreApp, { ai: core.aiService, auth: core.service });
      }
      if (core.founding100Service) {
        registerFounding100Routes(coreApp, core.founding100Service);
      }
      if (core.lawyerService) {
        registerLawyerRoutes(coreApp, { auth: core.service, lawyers: core.lawyerService });
      }
      if (core.marketplaceService) {
        registerMarketplaceRoutes(coreApp, {
          auth: core.service,
          marketplace: core.marketplaceService,
        });
      }
      if (core.adminService) {
        registerAdminRoutes(coreApp, {
          ...(core.creditService ? { credits: core.creditService } : {}),
          ...(core.founding100Service ? { founding100: core.founding100Service } : {}),
          production: core.production,
          service: core.adminService,
        });
      }
      if (core.paymentService) {
        registerPaymentRoutes(coreApp, {
          ...(core.adminService ? { admin: core.adminService } : {}),
          auth: core.service,
          payments: core.paymentService,
        });
      }
      registerInternalRoutes(
        coreApp,
        core.service,
        core.internalBotSecret,
        core.lawyerService,
        core.creditService,
        core.marketplaceService,
        core.aiService,
        core.founding100Service,
      );
    });
  }

  return app;
}
