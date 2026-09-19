import type { FastifyInstance } from 'fastify';
import { logPerformance } from '../lib/performance.js';

const requestStartedAt = new WeakMap<object, number>();

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    requestStartedAt.set(request, performance.now());
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = requestStartedAt.get(request);
    if (startedAt === undefined) return;
    logPerformance(request, 'api_handler', performance.now() - startedAt, {
      method: request.method,
      route: request.routeOptions.url,
      statusCode: reply.statusCode,
    });
    requestStartedAt.delete(request);
  });
}
