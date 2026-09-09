import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateRequest, parseInput, setSessionCookie, SESSION_COOKIE_NAME } from './http.js';
import type { CoreAuthService } from './service.js';

const challengeSchema = z.string().min(32).max(128);
const requestIdSchema = z.string().uuid();
const pinSchema = z.string().regex(/^\d{4}$/);

export interface AuthRouteOptions {
  production: boolean;
  service: CoreAuthService;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { service } = options;

  app.post('/auth/telegram/start', async (_request, reply) => {
    const login = await service.startTelegramLogin();
    return reply.status(201).send(login);
  });

  app.get('/auth/telegram/status/:requestId', async (request) => {
    const params = parseInput(z.object({ requestId: requestIdSchema }).strict(), request.params);
    return service.getTelegramLoginStatus(params.requestId);
  });

  app.post('/auth/telegram/confirm', async (request, reply) => {
    const body = parseInput(
      z.object({ challenge: challengeSchema, requestId: requestIdSchema }).strict(),
      request.body,
    );
    const issued = await service.consumeTelegramLogin(body.requestId, body.challenge);
    setSessionCookie(reply, issued, options.production);
    return reply.send({
      expiresAt: issued.session.expires_at,
      user: service.toUserView(issued.user),
    });
  });

  app.post('/auth/pin/verify', async (request, reply) => {
    const body = parseInput(
      z.object({ duid: z.string().min(4).max(64), pin: pinSchema }).strict(),
      request.body,
    );
    const issued = await service.verifyPin(body.duid, body.pin);
    setSessionCookie(reply, issued, options.production);
    return reply.send({
      expiresAt: issued.session.expires_at,
      user: service.toUserView(issued.user),
    });
  });

  app.post('/auth/pin/reset', async (request, reply) => {
    const body = parseInput(
      z
        .object({ challenge: challengeSchema, newPin: pinSchema, requestId: requestIdSchema })
        .strict(),
      request.body,
    );
    const issued = await service.resetPin(body.requestId, body.challenge, body.newPin);
    setSessionCookie(reply, issued, options.production);
    return reply.send({
      expiresAt: issued.session.expires_at,
      user: service.toUserView(issued.user),
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const authenticated = await authenticateRequest(request, service);
    await service.logout(authenticated.session.id);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/auth/session', async (request) => {
    const authenticated = await authenticateRequest(request, service);
    return {
      expiresAt: authenticated.session.expires_at,
      user: service.toUserView(authenticated.user),
    };
  });
}
