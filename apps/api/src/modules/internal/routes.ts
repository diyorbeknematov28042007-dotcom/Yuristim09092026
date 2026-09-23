import type { TelegramIdentityInput } from '@yuristim/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../auth/http.js';
import { verifyInternalRequest } from '../auth/internal-auth.js';
import type { CoreAuthService } from '../auth/service.js';

const identitySchema = z
  .object({
    telegramFirstName: z.string().trim().min(1).max(128).nullable(),
    telegramUserId: z.number().int().positive().safe(),
    telegramUsername: z.string().trim().min(1).max(64).nullable(),
  })
  .strict();

function parseIdentity(input: unknown): TelegramIdentityInput {
  return parseInput(identitySchema, input);
}

export function registerInternalRoutes(
  app: FastifyInstance,
  service: CoreAuthService,
  internalBotSecret: string,
): void {
  app.post('/internal/telegram/users/ensure', async (request, reply) => {
    verifyInternalRequest(request, request.body, internalBotSecret);
    const identity = parseIdentity(request.body);
    const result = await service.ensureTelegramUser(identity);
    return reply.status(result.created ? 201 : 200).send({
      created: result.created,
      user: service.toUserView(result.user),
    });
  });

  app.post('/internal/telegram/auth/confirm', async (request) => {
    verifyInternalRequest(request, request.body, internalBotSecret);
    const body = parseInput(
      z.object({ challenge: z.string().min(32).max(128), identity: identitySchema }).strict(),
      request.body,
    );
    return service.confirmTelegramLogin(body.challenge, body.identity);
  });
}
