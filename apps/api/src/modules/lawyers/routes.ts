import { LANGUAGES } from '@yuristim/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateRequest, parseInput } from '../auth/http.js';
import type { CoreAuthService } from '../auth/service.js';
import type { LawyerService } from './service.js';

const languageSchema = z.enum(LANGUAGES).default('uz');
const draftSchema = z
  .object({
    bio: z.string().trim().min(20).max(1000),
    consultationPrice: z.number().min(0).max(1_000_000_000).nullable().optional(),
    experienceYears: z.number().int().min(0).max(70),
    fullName: z.string().trim().min(2).max(160),
    profileImagePath: z.string().min(1).max(512),
    region: z.string().trim().min(2).max(120),
    specializationCodes: z.array(z.string().min(2).max(64)).min(1).max(24),
    verificationDocumentPaths: z.array(z.string().min(1).max(512)).min(1).max(10),
  })
  .strict();

export function registerLawyerRoutes(
  app: FastifyInstance,
  options: { auth: CoreAuthService; lawyers: LawyerService },
): void {
  const { auth, lawyers } = options;

  app.get('/specializations', async (request) => {
    const query = parseInput(z.object({ language: languageSchema }).strict(), request.query);
    return { specializations: await lawyers.listSpecializations(query.language) };
  });

  app.post('/lawyers/apply', async (request, reply) => {
    parseInput(z.object({}).strict(), request.body ?? {});
    const { user } = await authenticateRequest(request, auth);
    return reply.status(201).send({ profile: await lawyers.apply(user) });
  });

  app.get('/lawyers/me', async (request) => {
    const { user } = await authenticateRequest(request, auth);
    return { profile: await lawyers.getOwn(user) };
  });

  app.get('/lawyers/me/verification', async (request) => {
    const { user } = await authenticateRequest(request, auth);
    return { verification: await lawyers.getVerification(user) };
  });

  app.post('/lawyers/me/verifications', async (request, reply) => {
    const body = parseInput(draftSchema, request.body);
    const { user } = await authenticateRequest(request, auth);
    return reply.status(201).send({ verification: await lawyers.submit(user, body) });
  });

  app.post('/lawyers/me/verifications/draft', async (request, reply) => {
    const body = parseInput(
      z.object({ type: z.enum(['initial', 'profile_update']).default('initial') }).strict(),
      request.body ?? {},
    );
    const { user } = await authenticateRequest(request, auth);
    return reply.status(201).send({ verification: await lawyers.startDraft(user, body.type) });
  });

  app.post('/lawyers/me/verifications/files', async (request, reply) => {
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
    const { user } = await authenticateRequest(request, auth);
    return reply.status(201).send(await lawyers.uploadFile(user, body));
  });

  app.post('/lawyers/me/profile-change', async (request, reply) => {
    const body = parseInput(draftSchema.partial().strict(), request.body);
    const { user } = await authenticateRequest(request, auth);
    return reply.status(201).send({ verification: await lawyers.requestProfileChange(user, body) });
  });

  app.get('/lawyers', async (request) => {
    const query = parseInput(
      z
        .object({
          language: languageSchema,
          limit: z.coerce.number().int().min(1).max(50).default(20),
          min_experience: z.coerce.number().int().min(0).max(70).optional(),
          page: z.coerce.number().int().min(1).default(1),
          region: z.string().trim().min(2).max(120).optional(),
          sort: z.enum(['rating', 'experience', 'newest']).default('rating'),
          specialization: z.string().trim().min(2).max(64).optional(),
        })
        .strict(),
      request.query,
    );
    return lawyers.search(
      {
        limit: query.limit,
        minExperience: query.min_experience,
        page: query.page,
        region: query.region,
        sort: query.sort,
        specialization: query.specialization,
      },
      query.language,
    );
  });

  app.get('/lawyers/:duid', async (request) => {
    const params = parseInput(
      z.object({ duid: z.string().regex(/^yr_[A-Za-z0-9_-]{8,48}$/) }).strict(),
      request.params,
    );
    const query = parseInput(z.object({ language: languageSchema }).strict(), request.query);
    return { profile: await lawyers.getPublic(params.duid, query.language) };
  });
}
