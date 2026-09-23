import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
  type RawServerDefault,
} from 'fastify';
import { registerErrorHandler } from './lib/errors.js';
import { registerRequestContext } from './plugins/request-context.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  logger?: FastifyServerOptions<RawServerDefault>['logger'];
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
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

  return app;
}
