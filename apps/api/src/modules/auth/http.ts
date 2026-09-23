import type { FastifyReply, FastifyRequest } from 'fastify';
import type { output, ZodType } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { AuthenticatedSession, CoreAuthService, IssuedSession } from './service.js';

export const SESSION_COOKIE_NAME = 'yuristim_session';

export function parseInput<TSchema extends ZodType>(
  schema: TSchema,
  input: unknown,
): output<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed');
  }
  return result.data;
}

export function readSessionToken(request: FastifyRequest): string {
  const cookieToken = request.cookies[SESSION_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ') && authorization.length > 7) {
    return authorization.slice(7);
  }
  throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required');
}

export function authenticateRequest(
  request: FastifyRequest,
  service: CoreAuthService,
): Promise<AuthenticatedSession> {
  return service.authenticate(readSessionToken(request));
}

export function setSessionCookie(
  reply: FastifyReply,
  issued: IssuedSession,
  production: boolean,
): void {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(issued.session.expires_at).getTime() - Date.now()) / 1_000),
  );
  reply.setCookie(SESSION_COOKIE_NAME, issued.rawToken, {
    httpOnly: true,
    maxAge,
    path: '/',
    sameSite: 'lax',
    secure: production,
  });
}
