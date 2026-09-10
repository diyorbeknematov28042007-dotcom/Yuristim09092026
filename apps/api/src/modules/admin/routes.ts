import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { parseInput } from '../auth/http.js';
import type { AdminService, IssuedAdminSession } from './service.js';
import type { CreditService } from '../credits/service.js';

const ADMIN_COOKIE = 'yuristim_admin_session';

function readAdminToken(request: FastifyRequest): string {
  const token = request.cookies[ADMIN_COOKIE];
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Admin authentication is required');
  return token;
}

function setCookie(reply: FastifyReply, issued: IssuedAdminSession, production: boolean): void {
  reply.setCookie(ADMIN_COOKIE, issued.rawToken, {
    httpOnly: true,
    maxAge: Math.max(
      0,
      Math.floor((new Date(issued.session.expires_at).getTime() - Date.now()) / 1000),
    ),
    path: '/',
    sameSite: 'strict',
    secure: production,
  });
}

export function registerAdminRoutes(
  app: FastifyInstance,
  options: { service: AdminService; production: boolean; credits?: CreditService },
): void {
  const service = options.service;
  app.post('/admin/auth/login', async (request, reply) => {
    const body = parseInput(
      z
        .object({
          password: z.string().min(8).max(256),
          username: z.string().trim().min(3).max(64),
        })
        .strict(),
      request.body,
    );
    const forwarded = request.headers['x-forwarded-for'];
    const issued = await service.login({
      ip: typeof forwarded === 'string' ? (forwarded.split(',')[0]?.trim() ?? null) : request.ip,
      password: body.password,
      userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
      username: body.username,
    });
    setCookie(reply, issued, options.production);
    return { admin: service.toView(issued.admin), expiresAt: issued.session.expires_at };
  });

  app.get('/admin/auth/session', async (request) => {
    const authenticated = await service.authenticate(readAdminToken(request));
    return {
      admin: service.toView(authenticated.admin),
      expiresAt: authenticated.session.expires_at,
    };
  });

  app.post('/admin/auth/logout', async (request, reply) => {
    const authenticated = await service.authenticate(readAdminToken(request));
    await service.revoke(authenticated.session.id);
    reply.clearCookie(ADMIN_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/admin/lawyer-verifications', async (request) => {
    await service.authenticate(readAdminToken(request));
    const query = parseInput(
      z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          page: z.coerce.number().int().min(1).default(1),
          status: z
            .enum(['draft', 'submitted', 'pending_review', 'approved', 'rejected'])
            .optional(),
        })
        .strict(),
      request.query,
    );
    return service.listVerifications(query);
  });

  app.get('/admin/lawyer-verifications/:id', async (request) => {
    await service.authenticate(readAdminToken(request));
    const params = parseInput(z.object({ id: z.string().uuid() }).strict(), request.params);
    return service.getVerification(params.id);
  });

  app.post('/admin/lawyer-verifications/:id/approve', async (request, reply) => {
    const { admin } = await service.authenticate(readAdminToken(request));
    const params = parseInput(z.object({ id: z.string().uuid() }).strict(), request.params);
    parseInput(z.object({}).strict(), request.body ?? {});
    await service.review(admin, params.id, 'approved', null);
    return reply.status(204).send();
  });

  app.post('/admin/lawyer-verifications/:id/reject', async (request, reply) => {
    const { admin } = await service.authenticate(readAdminToken(request));
    const params = parseInput(z.object({ id: z.string().uuid() }).strict(), request.params);
    const body = parseInput(
      z.object({ reason: z.string().trim().min(3).max(1000) }).strict(),
      request.body,
    );
    await service.review(admin, params.id, 'rejected', body.reason);
    return reply.status(204).send();
  });

  if (options.credits) {
    app.post('/admin/users/:id/credits', async (request, reply) => {
      const { admin } = await service.authenticate(readAdminToken(request));
      if (admin.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Admin role is required');
      const params = parseInput(z.object({ id: z.string().uuid() }).strict(), request.params);
      const body = parseInput(
        z
          .object({
            amount: z.number().positive().max(1_000_000),
            reason: z.string().trim().min(3).max(1000),
            type: z.literal('admin_bonus'),
          })
          .strict(),
        request.body,
      );
      const reference = request.headers['idempotency-key'];
      if (typeof reference !== 'string' || reference.length < 8)
        throw new AppError(400, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
      const transaction = await options.credits!.grantBonus({
        adminId: admin.id,
        amount: body.amount,
        reason: body.reason,
        referenceId: reference.slice(0, 160),
        userId: params.id,
      });
      return reply.status(201).send({ transaction });
    });
  }
}
