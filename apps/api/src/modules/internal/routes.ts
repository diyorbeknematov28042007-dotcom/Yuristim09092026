import type { TelegramIdentityInput } from '@yuristim/db';
import {
  LANGUAGES,
  AI_MODES,
  USER_ROLES,
  type BotOnboardingAction,
  type BotVerificationAction,
  type BotMarketplaceDraftAction,
  type Language,
} from '@yuristim/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../auth/http.js';
import { verifyInternalRequest } from '../auth/internal-auth.js';
import type { CoreAuthService } from '../auth/service.js';
import type { LawyerService } from '../lawyers/service.js';
import type { CreditService } from '../credits/service.js';
import type { MarketplaceService } from '../marketplace/service.js';
import type { AiService } from '../ai/service.js';
import { logPerformance } from '../../lib/performance.js';

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
const marketplaceDraftActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z
    .object({
      action: z.literal('set_specialization'),
      specializationCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_description'),
      description: z.string().trim().min(20).max(1500),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_region'),
      region: z.string().trim().min(2).max(120).nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_additional_details'),
      additionalDetails: z.string().trim().min(2).max(1500).nullable(),
    })
    .strict(),
  z.object({ action: z.literal('back') }).strict(),
  z.object({ action: z.literal('cancel') }).strict(),
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
  marketplaceService?: MarketplaceService,
  aiService?: AiService,
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

  if (lawyerService && marketplaceService && aiService) {
    app.get('/internal/telegram/users/:telegramUserId/runtime-context', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const reads: Record<string, number> = {};
      const startedAt = performance.now();
      const timed = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
        const readStartedAt = performance.now();
        try {
          return await operation();
        } finally {
          reads[name] = performance.now() - readStartedAt;
        }
      };

      const user = await timed('user', () =>
        service.getTelegramUserForInternal(params.telegramUserId),
      );
      const parallelStartedAt = performance.now();
      const [lawyer, marketplaceDraft, ai] = await Promise.all([
        timed('lawyer', () => lawyerService.getBotRoutingState(user)),
        timed('marketplace', () => marketplaceService.getDraft(user.id)),
        timed('ai', () => aiService.botRoutingState(user.id)),
      ]);
      const userView = service.toUserView(user);
      logPerformance(request, 'database/context_reads', performance.now() - startedAt, {
        aiReadMilliseconds: reads.ai,
        lawyerReadMilliseconds: reads.lawyer,
        marketplaceReadMilliseconds: reads.marketplace,
        parallelReadMilliseconds: performance.now() - parallelStartedAt,
        userReadMilliseconds: reads.user,
      });
      return {
        ai,
        lawyer,
        marketplace: { draftStep: marketplaceDraft?.step ?? null },
        user: {
          activeMode: userView.activeMode,
          language: userView.language,
          onboardingRole: userView.onboardingRole,
          onboardingStatus: userView.onboardingStatus,
        },
      };
    });
  }

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

  if (aiService) {
    app.get('/internal/ai/providers/status', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      return { providers: await aiService.providerStatus() };
    });

    app.post('/internal/telegram/users/:telegramUserId/ai/enter', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      parseInput(z.object({}).strict(), request.body ?? {});
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return aiService.enterBot(user.id, userLanguage(user.language));
    });

    app.post('/internal/telegram/users/:telegramUserId/ai/leave', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      parseInput(z.object({}).strict(), request.body ?? {});
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      await aiService.leaveBot(user.id);
      return { success: true };
    });

    app.get('/internal/telegram/users/:telegramUserId/ai/status', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return aiService.botStatus(user.id);
    });

    app.patch('/internal/telegram/users/:telegramUserId/ai/controller', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const messageIdSchema = z.number().int().positive().safe().nullable();
      const body = parseInput(
        z
          .object({
            expectedMessageId: messageIdSchema,
            newMessageId: messageIdSchema,
          })
          .strict(),
        request.body,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return {
        replaced: await aiService.replaceBotController(
          user.id,
          body.expectedMessageId,
          body.newMessageId,
        ),
      };
    });

    app.get('/internal/telegram/users/:telegramUserId/ai/conversations', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return {
        items: await aiService.listConversations(user.id, userLanguage(user.language), 20),
      };
    });

    app.post(
      '/internal/telegram/users/:telegramUserId/ai/conversations',
      async (request, reply) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z.object({ telegramUserId: telegramUserIdSchema }).strict(),
          request.params,
        );
        const body = parseInput(
          z.object({ mode: z.enum(AI_MODES).default('fast') }).strict(),
          request.body,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return reply.status(201).send({
          conversation: await aiService.createConversation(
            user.id,
            userLanguage(user.language),
            body.mode,
          ),
        });
      },
    );

    app.get(
      '/internal/telegram/users/:telegramUserId/ai/conversations/:conversationId',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z
            .object({
              conversationId: z.string().regex(/^aic_[a-f0-9]{24}$/),
              telegramUserId: telegramUserIdSchema,
            })
            .strict(),
          request.params,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return aiService.getConversation(
          user.id,
          params.conversationId,
          userLanguage(user.language),
        );
      },
    );

    app.post(
      '/internal/telegram/users/:telegramUserId/ai/conversations/:conversationId/resume',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z
            .object({
              conversationId: z.string().regex(/^aic_[a-f0-9]{24}$/),
              telegramUserId: telegramUserIdSchema,
            })
            .strict(),
          request.params,
        );
        parseInput(z.object({}).strict(), request.body ?? {});
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return {
          conversation: await aiService.resumeBot(
            user.id,
            params.conversationId,
            userLanguage(user.language),
          ),
        };
      },
    );

    app.patch(
      '/internal/telegram/users/:telegramUserId/ai/conversations/:conversationId/mode',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z
            .object({
              conversationId: z.string().regex(/^aic_[a-f0-9]{24}$/),
              telegramUserId: telegramUserIdSchema,
            })
            .strict(),
          request.params,
        );
        const body = parseInput(z.object({ mode: z.enum(AI_MODES) }).strict(), request.body);
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return {
          conversation: await aiService.switchMode(
            user.id,
            params.conversationId,
            userLanguage(user.language),
            body.mode,
          ),
        };
      },
    );

    app.post(
      '/internal/telegram/users/:telegramUserId/ai/conversations/:conversationId/messages',
      async (request, reply) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z
            .object({
              conversationId: z.string().regex(/^aic_[a-f0-9]{24}$/),
              telegramUserId: telegramUserIdSchema,
            })
            .strict(),
          request.params,
        );
        const body = parseInput(
          z
            .object({
              content: z.string().trim().min(1).max(12_000),
              idempotencyKey: z.string().min(8).max(160),
            })
            .strict(),
          request.body,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        const result = await aiService.send({
          content: body.content,
          conversationId: params.conversationId,
          idempotencyKey: body.idempotencyKey,
          language: userLanguage(user.language),
          performance: (metric) => {
            const { durationMilliseconds, event, ...details } = metric;
            logPerformance(request, event, durationMilliseconds, details);
          },
          requestId: request.id,
          telemetry: (event) => request.log.info(event, 'AI request completed'),
          userId: user.id,
        });
        return reply.status(result.duplicate ? 200 : 201).send(result);
      },
    );

    app.post(
      '/internal/telegram/users/:telegramUserId/ai/messages/:messageId/delivery-failure',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z
            .object({
              messageId: z.string().regex(/^aim_[a-f0-9]{24}$/),
              telegramUserId: telegramUserIdSchema,
            })
            .strict(),
          request.params,
        );
        parseInput(z.object({}).strict(), request.body ?? {});
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        await aiService.reverseDeliveryFailure(user.id, params.messageId);
        return { success: true };
      },
    );
  }

  if (marketplaceService) {
    app.get('/internal/telegram/users/:telegramUserId/marketplace/draft', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return { draft: await marketplaceService.getDraft(user.id) };
    });

    app.patch('/internal/telegram/users/:telegramUserId/marketplace/draft', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const action: BotMarketplaceDraftAction = parseInput(
        marketplaceDraftActionSchema,
        request.body,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return { draft: await marketplaceService.updateDraft(user, action) };
    });

    app.post(
      '/internal/telegram/users/:telegramUserId/marketplace/confirm',
      async (request, reply) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z.object({ telegramUserId: telegramUserIdSchema }).strict(),
          request.params,
        );
        const body = parseInput(
          z.object({ idempotencyKey: z.string().min(8).max(128) }).strict(),
          request.body,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return reply.status(201).send({
          post: await marketplaceService.confirmDraft(
            user,
            body.idempotencyKey,
            userLanguage(user.language),
          ),
        });
      },
    );

    app.get('/internal/telegram/users/:telegramUserId/marketplace/requests', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return { items: await marketplaceService.listOwn(user.id, userLanguage(user.language)) };
    });

    app.get(
      '/internal/telegram/users/:telegramUserId/marketplace/requests/:postId/acceptances',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z.object({ postId: z.string().uuid(), telegramUserId: telegramUserIdSchema }).strict(),
          request.params,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return {
          items: await marketplaceService.acceptances(
            params.postId,
            user.id,
            userLanguage(user.language),
          ),
        };
      },
    );

    app.post(
      '/internal/telegram/users/:telegramUserId/marketplace/requests/:postId/select',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z.object({ postId: z.string().uuid(), telegramUserId: telegramUserIdSchema }).strict(),
          request.params,
        );
        const body = parseInput(
          z.object({ acceptanceId: z.string().regex(/^ma_[a-f0-9]{20}$/) }).strict(),
          request.body,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return marketplaceService.select(user.id, params.postId, body.acceptanceId);
      },
    );

    app.post(
      '/internal/telegram/users/:telegramUserId/marketplace/requests/:postId/cancel',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z.object({ postId: z.string().uuid(), telegramUserId: telegramUserIdSchema }).strict(),
          request.params,
        );
        parseInput(z.object({}).strict(), request.body ?? {});
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return marketplaceService.cancel(user.id, params.postId, userLanguage(user.language));
      },
    );

    app.post(
      '/internal/telegram/users/:telegramUserId/marketplace/requests/:postId/review',
      async (request, reply) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(
          z.object({ postId: z.string().uuid(), telegramUserId: telegramUserIdSchema }).strict(),
          request.params,
        );
        const body = parseInput(
          z
            .object({
              comment: z.string().trim().min(2).max(500).optional(),
              rating: z.number().int().min(1).max(5),
            })
            .strict(),
          request.body,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return reply.status(201).send({
          review: await marketplaceService.review(user.id, { ...body, postId: params.postId }),
        });
      },
    );

    app.get('/internal/telegram/marketplace/listings/:publicIdentifier', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ publicIdentifier: z.string().regex(/^mp_[a-f0-9]{24}$/) }).strict(),
        request.params,
      );
      const query = parseInput(
        z.object({ language: z.enum(LANGUAGES).default('uz') }).strict(),
        request.query,
      );
      return {
        post: await marketplaceService.publicContext(params.publicIdentifier, query.language),
      };
    });

    app.post(
      '/internal/telegram/users/:telegramUserId/marketplace/listings/:publicIdentifier/accept',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        parseInput(z.object({}).strict(), request.body ?? {});
        const params = parseInput(
          z
            .object({
              publicIdentifier: z.string().regex(/^mp_[a-f0-9]{24}$/),
              telegramUserId: telegramUserIdSchema,
            })
            .strict(),
          request.params,
        );
        const user = await service.getTelegramUserForInternal(params.telegramUserId);
        return marketplaceService.accept(user, params.publicIdentifier);
      },
    );

    app.get('/internal/telegram/users/:telegramUserId/marketplace/dashboard', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(
        z.object({ telegramUserId: telegramUserIdSchema }).strict(),
        request.params,
      );
      const user = await service.getTelegramUserForInternal(params.telegramUserId);
      return marketplaceService.lawyerDashboard(user.id, userLanguage(user.language));
    });

    app.patch(
      '/internal/telegram/marketplace/requests/:postId/channel-message',
      async (request) => {
        verifyInternalRequest(request, request.body, internalBotSecret);
        const params = parseInput(z.object({ postId: z.string().uuid() }).strict(), request.params);
        const body = parseInput(
          z.object({ messageId: z.number().int().positive() }).strict(),
          request.body,
        );
        await marketplaceService.recordChannelMessage(params.postId, body.messageId);
        return { ok: true };
      },
    );

    app.post('/internal/telegram/marketplace/requests/:postId/channel-failure', async (request) => {
      verifyInternalRequest(request, request.body, internalBotSecret);
      const params = parseInput(z.object({ postId: z.string().uuid() }).strict(), request.params);
      parseInput(z.object({}).strict(), request.body ?? {});
      await marketplaceService.recordChannelFailure(params.postId);
      return { ok: true };
    });
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
