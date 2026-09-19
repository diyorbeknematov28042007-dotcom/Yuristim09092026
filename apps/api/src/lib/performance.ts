import type { FastifyRequest } from 'fastify';

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export function requestCorrelationId(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value) ? value : request.id;
}

export function logPerformance(
  request: FastifyRequest,
  event: string,
  durationMilliseconds: number,
  details: Record<string, unknown> = {},
): void {
  request.log.info(
    {
      correlationId: requestCorrelationId(request),
      durationMilliseconds: Math.max(0, Math.round(durationMilliseconds * 10) / 10),
      event,
      requestId: request.id,
      ...details,
    },
    'Performance metric',
  );
}
