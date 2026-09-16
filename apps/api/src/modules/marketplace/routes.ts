import { LANGUAGES, type Language } from '@yuristim/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateRequest, parseInput } from '../auth/http.js';
import type { CoreAuthService } from '../auth/service.js';
import type { MarketplaceService } from './service.js';

const postId = z.string().uuid();
const publicIdentifier = z.string().regex(/^mp_[a-f0-9]{24}$/);
const languageSchema = z.enum(LANGUAGES).default('uz');
function language(value: string | null): Language {
  return LANGUAGES.includes(value as Language) ? (value as Language) : 'uz';
}

export function registerMarketplaceRoutes(
  app: FastifyInstance,
  options: { auth: CoreAuthService; marketplace: MarketplaceService },
): void {
  app.post('/marketplace/requests', async (request, reply) => {
    const body = parseInput(
      z
        .object({
          additionalDetails: z.string().trim().max(1500).optional(),
          description: z.string().trim().min(20).max(1500),
          idempotencyKey: z.string().min(8).max(128),
          region: z.string().trim().min(2).max(120).optional(),
          specializationCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
        })
        .strict(),
      request.body,
    );
    const { user } = await authenticateRequest(request, options.auth);
    return reply
      .status(201)
      .send({ post: await options.marketplace.create(user, body, language(user.language)) });
  });

  app.get('/marketplace/requests', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    return { items: await options.marketplace.listOwn(user.id, language(user.language)) };
  });

  app.get('/marketplace/requests/:postId', async (request) => {
    const params = parseInput(z.object({ postId }).strict(), request.params);
    const { user } = await authenticateRequest(request, options.auth);
    return {
      post: await options.marketplace.getOwn(params.postId, user.id, language(user.language)),
    };
  });

  app.post('/marketplace/requests/:postId/cancel', async (request) => {
    parseInput(z.object({}).strict(), request.body ?? {});
    const params = parseInput(z.object({ postId }).strict(), request.params);
    const { user } = await authenticateRequest(request, options.auth);
    return options.marketplace.cancel(user.id, params.postId, language(user.language));
  });

  app.get('/marketplace/requests/:postId/acceptances', async (request) => {
    const params = parseInput(z.object({ postId }).strict(), request.params);
    const { user } = await authenticateRequest(request, options.auth);
    return {
      items: await options.marketplace.acceptances(params.postId, user.id, language(user.language)),
    };
  });

  app.post('/marketplace/requests/:postId/select', async (request) => {
    const params = parseInput(z.object({ postId }).strict(), request.params);
    const body = parseInput(
      z.object({ acceptanceId: z.string().regex(/^ma_[a-f0-9]{20}$/) }).strict(),
      request.body,
    );
    const { user } = await authenticateRequest(request, options.auth);
    return options.marketplace.select(user.id, params.postId, body.acceptanceId);
  });

  app.post('/marketplace/requests/:postId/review', async (request, reply) => {
    const params = parseInput(z.object({ postId }).strict(), request.params);
    const body = parseInput(
      z
        .object({
          comment: z.string().trim().min(2).max(500).optional(),
          rating: z.number().int().min(1).max(5),
        })
        .strict(),
      request.body,
    );
    const { user } = await authenticateRequest(request, options.auth);
    return reply.status(201).send({
      review: await options.marketplace.review(user.id, { ...body, postId: params.postId }),
    });
  });

  app.get('/marketplace/listings/:publicIdentifier', async (request) => {
    const params = parseInput(z.object({ publicIdentifier }).strict(), request.params);
    const query = parseInput(z.object({ language: languageSchema }).strict(), request.query);
    return {
      post: await options.marketplace.publicContext(params.publicIdentifier, query.language),
    };
  });

  app.post('/marketplace/listings/:publicIdentifier/accept', async (request) => {
    parseInput(z.object({}).strict(), request.body ?? {});
    const params = parseInput(z.object({ publicIdentifier }).strict(), request.params);
    const { user } = await authenticateRequest(request, options.auth);
    return options.marketplace.accept(user, params.publicIdentifier);
  });

  app.get('/marketplace/lawyer/dashboard', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    return options.marketplace.lawyerDashboard(user.id, language(user.language));
  });
}
