import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { AdminService } from '../admin/service.js';
import { authenticateRequest, parseInput, readSessionToken } from '../auth/http.js';
import type { CoreAuthService } from '../auth/service.js';
import type { PaymentService } from './service.js';

const ADMIN_COOKIE = 'yuristim_admin_session';

export function registerPaymentRoutes(
  app: FastifyInstance,
  options: { auth: CoreAuthService; admin?: AdminService; payments: PaymentService },
): void {
  app.post('/payments/checkout', async (request, reply) => {
    const { user } = await authenticateRequest(request, options.auth);
    const body = parseInput(
      z
        .object({
          product_id: z.string().uuid(),
          product_type: z.enum(['credits', 'marketplace_accepts']),
        })
        .strict(),
      request.body,
    );
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8)
      throw new AppError(400, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
    const payment = await options.payments.checkout({
      idempotencyKey: idempotencyKey.slice(0, 160),
      productId: body.product_id,
      productType: body.product_type,
      userId: user.id,
    });
    return reply.status(201).send(payment);
  });

  app.get('/payments/:id', async (request) => {
    const params = parseInput(z.object({ id: z.string().uuid() }).strict(), request.params);
    try {
      const authenticated = await options.auth.authenticate(readSessionToken(request));
      return options.payments.get(params.id, authenticated.user.id);
    } catch (error) {
      const adminToken = request.cookies[ADMIN_COOKIE];
      if (!adminToken || !options.admin) throw error;
      await options.admin.authenticate(adminToken);
      return options.payments.get(params.id);
    }
  });

  app.post('/webhooks/payments/:provider', async (request) => {
    const params = parseInput(
      z.object({ provider: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/) }).strict(),
      request.params,
    );
    const event = parseInput(
      z
        .object({
          paymentId: z.string().uuid(),
          providerPaymentId: z.string().min(1).max(160),
          status: z.enum(['paid', 'failed', 'cancelled']),
        })
        .strict(),
      request.body,
    );
    const signature = request.headers['x-payment-signature'];
    if (typeof signature !== 'string')
      throw new AppError(
        401,
        'PAYMENT_VERIFICATION_FAILED',
        'Payment webhook signature is required',
      );
    return options.payments.webhook(params.provider, event, signature);
  });
}
