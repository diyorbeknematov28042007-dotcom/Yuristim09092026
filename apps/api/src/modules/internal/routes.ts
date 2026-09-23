import type { TelegramIdentityInput } from '@yuristim/db';
import { LANGUAGES, USER_ROLES, type BotOnboardingAction } from '@yuristim/types';
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

const telegramUserIdSchema = z.coerce.number().int().positive().safe();
const onboardingActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_language'), language: z.enum(LANGUAGES) }).strict(),
  z.object({ action: z.literal('set_role'), role: z.enum(USER_ROLES) }).strict(),
  z
    .object({ action: z.literal('set_full_name'), fullName: z.string().trim().min(2).max(160) })
    .strict(),
  z
    .object({ action: z.literal('accept_terms'), termsVersion: z.string().trim().min(1).max(64) })
    .strict(),
  z.object({ action: z.literal('reset') }).strict(),
]);

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

  app.get('/internal/telegram/users/:telegramUserId/context', async (request) => {
    verifyInternalRequest(request, request.body, internalBotSecret);
    const params = parseInput(
      z.object({ telegramUserId: telegramUserIdSchema }).strict(),
      request.params,
    );
    return service.getTelegramUserContext(params.telegramUserId);
  });

  app.patch('/internal/telegram/users/:telegramUserId/onboarding', async (request) => {
    verifyInternalRequest(request, request.body, internalBotSecret);
    const params = parseInput(
      z.object({ telegramUserId: telegramUserIdSchema }).strict(),
      request.params,
    );
    const action: BotOnboardingAction = parseInput(onboardingActionSchema, request.body);
    return service.updateTelegramOnboarding(params.telegramUserId, action);
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
