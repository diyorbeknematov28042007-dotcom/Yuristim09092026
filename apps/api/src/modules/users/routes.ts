import { LANGUAGES, USER_MODES, USER_ROLES } from '@yuristim/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateRequest, parseInput } from '../auth/http.js';
import type { CoreAuthService } from '../auth/service.js';

const fullNameSchema = z.string().trim().min(2).max(160).nullable();

export function registerUserRoutes(app: FastifyInstance, service: CoreAuthService): void {
  app.get('/users/me', async (request) => {
    const { user } = await authenticateRequest(request, service);
    return { user: service.toUserView(user) };
  });

  app.patch('/users/me', async (request) => {
    const body = parseInput(z.object({ fullName: fullNameSchema }).strict(), request.body);
    const { user } = await authenticateRequest(request, service);
    return { user: service.toUserView(await service.updateProfile(user.id, body.fullName)) };
  });

  app.patch('/users/me/language', async (request) => {
    const body = parseInput(z.object({ language: z.enum(LANGUAGES) }).strict(), request.body);
    const { user } = await authenticateRequest(request, service);
    return { user: service.toUserView(await service.updateLanguage(user.id, body.language)) };
  });

  app.post('/users/me/accept-terms', async (request) => {
    const body = parseInput(
      z.object({ version: z.string().trim().min(1).max(32) }).strict(),
      request.body,
    );
    const { user } = await authenticateRequest(request, service);
    return { user: service.toUserView(await service.acceptTerms(user.id, body.version)) };
  });

  app.post('/users/me/role', async (request) => {
    const body = parseInput(z.object({ role: z.enum(USER_ROLES) }).strict(), request.body);
    const { user } = await authenticateRequest(request, service);
    return { user: service.toUserView(await service.selectRole(user.id, body.role)) };
  });

  app.post('/users/me/mode', async (request) => {
    const body = parseInput(z.object({ mode: z.enum(USER_MODES) }).strict(), request.body);
    const { user } = await authenticateRequest(request, service);
    return { user: service.toUserView(await service.switchMode(user.id, body.mode)) };
  });

  app.get('/users/me/tags', async (request) => {
    const { user } = await authenticateRequest(request, service);
    return { tags: await service.getTags(user.id) };
  });
}
