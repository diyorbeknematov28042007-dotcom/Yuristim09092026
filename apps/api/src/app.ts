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
import { registerAuthRoutes } from './modules/auth/routes.js';
import type { CoreAuthService } from './modules/auth/service.js';
import { registerCreditRoutes } from './modules/credits/routes.js';
import type { CreditService } from './modules/credits/service.js';
import { registerInternalRoutes } from './modules/internal/routes.js';
import { registerLawyerRoutes } from './modules/lawyers/routes.js';
import type { LawyerService } from './modules/lawyers/service.js';
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
  };
  logger?: FastifyServerOptions<RawServerDefault>['logger'];
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    bodyLimit: 7_500_000,
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

  app.register(healthRoutes);

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
      if (core.lawyerService) {
        registerLawyerRoutes(coreApp, { auth: core.service, lawyers: core.lawyerService });
      }
      if (core.adminService) {
        registerAdminRoutes(coreApp, {
          ...(core.creditService ? { credits: core.creditService } : {}),
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
      );
    });
  }

  return app;
}
