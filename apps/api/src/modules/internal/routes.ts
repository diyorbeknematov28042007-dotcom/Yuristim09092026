import type { TelegramIdentityInput } from '@yuristim/db';
import {
  LANGUAGES,
  USER_ROLES,
  type BotOnboardingAction,
  type BotVerificationAction,
  type Language,
} from '@yuristim/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../auth/http.js';
import { verifyInternalRequest } from '../auth/internal-auth.js';
import type { CoreAuthService } from '../auth/service.js';
import type { LawyerService } from '../lawyers/service.js';
import type { CreditService } from '../credits/service.js';

const identitySchema = z
  .object({
    telegramFirstName: z.string().trim().min(1).max(128).nullable(),
    telegramUserId: z.number().int().positive().safe(),
    telegramUsername: z.string().trim().min(1).max(64).nullable(),
  })
  .strict();

const telegramUserIdSchema = z.coerce.number().int().positive().safe();
function userLanguage(value: string | null): Language {
  return LANGUAGES.includes(value as Language) ? (value as Language) : 'uz';
}
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
const verificationActionSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('start'), type: z.enum(['initial', 'profile_update']).optional() })
    .strict(),
  z
    .object({ action: z.literal('set_full_name'), fullName: z.string().trim().min(2).max(160) })
    .strict(),
  z.object({ action: z.literal('set_region'), region: z.string().trim().min(2).max(120) }).strict(),
  z
    .object({ action: z.literal('toggle_specialization'), code: z.string().min(2).max(64) })
    .strict(),
  z.object({ action: z.literal('finish_specializations') }).strict(),
  z
    .object({
      action: z.literal('set_experience'),
      experienceYears: z.number().int().min(0).max(70),
    })
    .strict(),
  z.object({ action: z.literal('set_bio'), bio: z.string().trim().min(20).max(1000) }).strict(),
  z
    .object({
      action: z.literal('set_price'),
      consultationPrice: z.number().min(0).max(1_000_000_000).nullable(),
    })
    .strict(),
  z.object({ action: z.literal('set_profile_image'), path: z.string().min(1).max(512) }).strict(),
  z
    .object({ action: z.literal('add_verification_document'), path: z.string().min(1).max(512) })
    .strict(),
  z.object({ action: z.literal('back') }).strict(),
  z.object({ action: z.literal('cancel') }).strict(),
  z.object({ action: z.literal('submit') }).strict(),
]);

function parseIdentity(input: unknown): TelegramIdentityInput {
  return parseInput(identitySchema, input);
}

export function registerInternalRoutes(
  app: FastifyInstance,
  service: CoreAuthService,
  internalBotSecret: string,
  lawyerService?: LawyerService,
  creditService?: CreditService,
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

  if (creditService) {
    app.get('/internal/telegram/users/:telegramUserId/credits/balance', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return creditService.getBalance(user.id);
    });

    app.get('/internal/telegram/users/:telegramUserId/credits/transactions', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const query = parseInput(
        z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) }).strict(),
        request.query,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return creditService.history({ limit: query.limit, page: 1, userId: user.id });
    });

    app.get('/internal/telegram/users/:telegramUserId/credits/products', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return { items: await creditService.products(userLanguage(user.language)) };
    });

    app.get(
      '/internal/telegram/users/:telegramUserId/marketplace/accept-balance',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z.object({ telegramUserId: telegramUserIdSchema }).strict(),
          request.params,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return creditService.acceptBalance(user.id);
      },
    );

    app.get(
      '/internal/telegram/users/:telegramUserId/marketplace/accept-products',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z.object({ telegramUserId: telegramUserIdSchema }).strict(),
          request.params,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return { items: await creditService.acceptProducts(user.id, userLanguage(user.language)) };
      },
    );
  }

  if (!lawyerService) return;

  app.get('/internal/telegram/users/:telegramUserId/lawyer', async (request) => {
    verifyInternalRequest(request, request.body, internalBotSecret);
    const params = parseInput(
      z.object({ telegramUserId: telegramUserIdSchema }).strict(),
      request.params,
    );
    const user = await service.getTelegramUserForInternal(params.telegramUserId);
    return lawyerService.getBotContext(user);
  });

  app.patch('/internal/telegram/users/:telegramUserId/lawyer/verification', async (request) => {
    verifyInternalRequest(request, request.body, internalBotSecret);
    const params = parseInput(
      z.object({ telegramUserId: telegramUserIdSchema }).strict(),
      request.params,
    );
    const action: BotVerificationAction = parseInput(verificationActionSchema, request.body);
    const user = await service.getTelegramUserForInternal(params.telegramUserId);
    return { verification: await lawyerService.updateDraft(user, action) };
  });

  app.post('/internal/telegram/users/:telegramUserId/lawyer/files', async (request, reply) => {
    verifyInternalRequest(request, request.body, internalBotSecret);
    const params = parseInput(
      z.object({ telegramUserId: telegramUserIdSchema }).strict(),
      request.params,
    );
    const body = parseInput(
      z
        .object({
          base64: z.string().min(4).max(7_100_000),
          contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
          kind: z.enum(['profile_image', 'verification_document']),
          originalFilename: z.string().trim().min(1).max(255),
        })
        .strict(),
      request.body,
    );
    const user = await service.getTelegramUserForInternal(params.telegramUserId);
    return reply.status(201).send(await lawyerService.uploadFile(user, body));
  });

  app.post('/internal/telegram/users/:telegramUserId/mode', async (request) => {
    verifyInternalRequest(request, request.body, internalBotSecret);
    const params = parseInput(
      z.object({ telegramUserId: telegramUserIdSchema }).strict(),
      request.params,
    );
    const body = parseInput(z.object({ mode: z.enum(['user', 'lawyer']) }).strict(), request.body);
    const user = await service.getTelegramUserForInternal(params.telegramUserId);
    return { user: service.toUserView(await service.switchMode(user.id, body.mode)) };
  });
}
