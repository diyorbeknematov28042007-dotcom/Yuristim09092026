import { SERVICE_NAMES } from '@yuristim/config';
import type { ServiceHealthResponse } from '@yuristim/types';
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(
  app: FastifyInstance,
  aiAvailability?: () => Record<'fast' | 'expert', boolean>,
): Promise<void> {
  app.get('/health', async (request): Promise<ServiceHealthResponse> => {
    return {
      status: 'ok',
      service: SERVICE_NAMES.api,
      requestId: request.id,
    };
  });

  app.get('/ready', async (request): Promise<ServiceHealthResponse> => {
    return {
      ...(aiAvailability ? { dependencies: { ai: aiAvailability() } } : {}),
      status: 'ready',
      service: SERVICE_NAMES.api,
      requestId: request.id,
    };
  });
}
