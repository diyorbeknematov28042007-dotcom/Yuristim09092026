import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { safeEqual } from './crypto.js';

const INTERNAL_REQUEST_WINDOW_SECONDS = 300;

export function signInternalRequest(
  method: string,
  path: string,
  body: unknown,
  timestamp: string,
  secret: string,
): string {
  return `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${method.toUpperCase()}.${path}.${JSON.stringify(body)}`)
    .digest('hex')}`;
}

export function verifyInternalRequest(
  request: FastifyRequest,
  body: unknown,
  secret: string,
  now = new Date(),
): void {
  const timestamp = request.headers['x-yuristim-timestamp'];
  const signature = request.headers['x-yuristim-signature'];
  if (typeof timestamp !== 'string' || typeof signature !== 'string') {
    throw new AppError(401, 'UNAUTHORIZED', 'Internal authentication is required');
  }

  const timestampSeconds = Number(timestamp);
  const age = Math.abs(Math.floor(now.getTime() / 1_000) - timestampSeconds);
  if (!Number.isSafeInteger(timestampSeconds) || age > INTERNAL_REQUEST_WINDOW_SECONDS) {
    throw new AppError(401, 'UNAUTHORIZED', 'Internal request timestamp is invalid');
  }

  const path = new URL(request.url, 'http://internal.local').pathname;
  const expected = signInternalRequest(request.method, path, body, timestamp, secret);
  if (!safeEqual(signature, expected)) {
    throw new AppError(401, 'UNAUTHORIZED', 'Internal request signature is invalid');
  }
}
