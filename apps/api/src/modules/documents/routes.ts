import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { authenticateRequest, parseInput } from '../auth/http.js';
import type { CoreAuthService } from '../auth/service.js';
import { readAdminToken } from '../admin/routes.js';
import type { AdminService } from '../admin/service.js';
import type { DocumentContributionService } from './service.js';
const idSchema = z.object({ id: z.string().uuid() }).strict();
const pageSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum(['submitted', 'under_review', 'approved', 'rejected']).optional(),
  })
  .strict();
export function registerDocumentContributionRoutes(
  app: FastifyInstance,
  options: { auth: CoreAuthService; documents: DocumentContributionService; admin?: AdminService },
): void {
  const { documents } = options;
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  const owner = async (request: FastifyRequest) =>
    (await authenticateRequest(request, options.auth)).user.id;
  const admin = async (request: FastifyRequest) => {
    if (!options.admin) throw new AppError(401, 'UNAUTHORIZED', 'Admin authentication required');
    const session = await options.admin.authenticate(readAdminToken(request));
    if (session.admin.role !== 'admin')
      throw new AppError(403, 'FORBIDDEN', 'Admin review access required');
    return session.admin.id;
  };
  const id = (request: FastifyRequest) => parseInput(idSchema, request.params).id;
  app.post('/document-contributions/uploads', { bodyLimit: 16384 }, async (request, reply) => {
    const userId = await owner(request);
    const key = parseInput(z.string().uuid(), request.headers['idempotency-key']);
    const input = parseInput(
      z
        .object({
          documentType: z.string().max(64),
          originalFilename: z.string().max(200),
          mimeType: z.string().max(200),
          fileSizeBytes: z.number(),
          privacyAcknowledged: z.boolean(),
          rightsConfirmed: z.boolean(),
        })
        .strict(),
      request.body,
    );
    return reply.status(201).send(await documents.initiate(userId, input, key));
  });
  app.get('/document-contributions/me', async (request) =>
    documents.list(
      parseInput(pageSchema.omit({ status: true }), request.query),
      await owner(request),
    ),
  );
  app.get('/document-contributions/:id', async (request) => ({
    contribution: await documents.detail(id(request), await owner(request)),
  }));
  app.get('/document-contributions/:id/file', async (request) =>
    documents.file(id(request), await owner(request)),
  );
  app.post('/document-contributions/:id/submit', { bodyLimit: 1024 }, async (request) => ({
    contribution: await documents.submit(id(request), await owner(request)),
  }));
  app.get('/admin/document-contributions', async (request) => {
    await admin(request);
    return documents.list(parseInput(pageSchema, request.query));
  });
  app.get('/admin/document-contributions/:id', async (request) => {
    await admin(request);
    return { contribution: await documents.detail(id(request)) };
  });
  app.get('/admin/document-contributions/:id/file', async (request) => {
    await admin(request);
    return documents.file(id(request));
  });
  for (const [action, decision] of [
    ['under-review', 'under_review'],
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ] as const)
    app.post(
      `/admin/document-contributions/:id/${action}`,
      { bodyLimit: 8192 },
      async (request) => {
        const adminId = await admin(request);
        const reason =
          decision === 'rejected'
            ? parseInput(
                z.object({ reason: z.string().trim().min(3).max(1000) }).strict(),
                request.body,
              ).reason
            : null;
        return { contribution: await documents.review(id(request), adminId, decision, reason) };
      },
    );
}
