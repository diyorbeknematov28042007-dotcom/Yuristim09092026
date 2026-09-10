import { CREDIT_TRANSACTION_TYPES, LANGUAGES, type Language } from '@yuristim/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateRequest, parseInput } from '../auth/http.js';
import type { CoreAuthService } from '../auth/service.js';
import type { CreditService } from './service.js';

const languageSchema = z.enum(LANGUAGES).default('uz');

function userLanguage(value: string | null): Language {
  return LANGUAGES.includes(value as Language) ? (value as Language) : 'uz';
}

export function registerCreditRoutes(
  app: FastifyInstance,
  options: { auth: CoreAuthService; credits: CreditService },
): void {
  app.get('/credits/balance', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    return options.credits.getBalance(user.id);
  });

  app.get('/credits/transactions', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    const query = parseInput(
      z
        .object({
          from: z.coerce.date().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          page: z.coerce.number().int().min(1).default(1),
          to: z.coerce.date().optional(),
          type: z.enum(CREDIT_TRANSACTION_TYPES).optional(),
        })
        .strict()
        .refine((value) => !value.from || !value.to || value.from <= value.to),
      request.query,
    );
    return options.credits.history({ ...query, userId: user.id });
  });

  app.get('/credits/products', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    const query = parseInput(
      z.object({ language: languageSchema.optional() }).strict(),
      request.query,
    );
    return { items: await options.credits.products(query.language ?? userLanguage(user.language)) };
  });

  app.get('/marketplace/accept-balance', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    return options.credits.acceptBalance(user.id);
  });

  app.get('/marketplace/accept-products', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    const query = parseInput(
      z.object({ language: languageSchema.optional() }).strict(),
      request.query,
    );
    return {
      items: await options.credits.acceptProducts(
        user.id,
        query.language ?? userLanguage(user.language),
      ),
    };
  });
}
