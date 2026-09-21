import type { Founding100EventName } from '@yuristim/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../auth/http.js';
import type { Founding100Service } from './service.js';

const frontendEventSchema = z.enum([
  'beta_page_view',
  'beta_cta_click',
  'beta_slot_reserved',
  'telegram_opened',
]);

export function registerFounding100Routes(
  app: FastifyInstance,
  service: Founding100Service,
): void {
  app.get('/founding100/status', async () => service.status());

  app.post('/founding100/reservations', async (request, reply) => {
    const body = parseInput(
      z
        .object({
          idempotencyKey: z.string().trim().min(8).max(128),
          source: z.string().max(256).optional(),
        })
        .strict(),
      request.body,
    );

    return reply.status(201).send(await service.reserve(body.idempotencyKey, body.source));
  });

  app.post('/founding100/events', async (request, reply) => {
    const body = parseInput(
      z
        .object({
          event: frontendEventSchema,
          reservationId: z.string().uuid().optional(),
          source: z.string().max(256).optional(),
        })
        .strict(),
      request.body,
    );

    await service.recordFrontendEvent({
      eventName: body.event as Founding100EventName,
      ...(body.reservationId ? { reservationId: body.reservationId } : {}),
      source: body.source,
    });
    return reply.status(202).send({ accepted: true });
  });
}
