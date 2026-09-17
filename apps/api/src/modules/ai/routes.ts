import { AI_MODES, type Language } from '@yuristim/types';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { authenticateRequest, parseInput } from '../auth/http.js';
import type { CoreAuthService } from '../auth/service.js';
import type { AiService, AiTelemetry } from './service.js';

const conversationIdSchema = z.string().regex(/^aic_[a-f0-9]{24}$/);
const promptSchema = z.string().trim().min(1).max(12_000);
const idempotencySchema = z.string().min(8).max(160);

function language(value: string | null): Language {
  return value === 'ru' || value === 'en' ? value : 'uz';
}

function idempotencyKey(header: string | string[] | undefined): string {
  return parseInput(idempotencySchema, Array.isArray(header) ? header[0] : header);
}

function telemetry(log: { info(value: object, message: string): void }) {
  return (event: AiTelemetry) => log.info(event, 'AI request completed');
}

function waitForDrain(reply: FastifyReply): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      reply.raw.off('drain', drained);
      reply.raw.off('close', closed);
      reply.raw.off('error', failed);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const closed = () => {
      cleanup();
      reject(new Error('SSE connection closed'));
    };
    const failed = () => {
      cleanup();
      reject(new Error('SSE connection failed'));
    };
    reply.raw.once('drain', drained);
    reply.raw.once('close', closed);
    reply.raw.once('error', failed);
  });
}

async function writeSse(reply: FastifyReply, event: string, value: unknown): Promise<void> {
  if (reply.raw.destroyed || reply.raw.writableEnded) throw new Error('SSE connection closed');
  if (!reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)) {
    await waitForDrain(reply);
  }
}

export function registerAiRoutes(
  app: FastifyInstance,
  options: { auth: CoreAuthService; ai: AiService },
): void {
  app.post('/ai/conversations', async (request, reply) => {
    const { user } = await authenticateRequest(request, options.auth);
    const body = parseInput(
      z.object({ mode: z.enum(AI_MODES).default('fast') }).strict(),
      request.body,
    );
    return reply.status(201).send({
      conversation: await options.ai.createConversation(
        user.id,
        language(user.language),
        body.mode,
      ),
    });
  });

  app.get('/ai/conversations', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    const query = parseInput(
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict(),
      request.query,
    );
    return {
      items: await options.ai.listConversations(user.id, language(user.language), query.limit),
    };
  });

  app.get('/ai/conversations/:conversationId', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    const params = parseInput(
      z.object({ conversationId: conversationIdSchema }).strict(),
      request.params,
    );
    return options.ai.getConversation(user.id, params.conversationId, language(user.language));
  });

  app.patch('/ai/conversations/:conversationId/mode', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    const params = parseInput(
      z.object({ conversationId: conversationIdSchema }).strict(),
      request.params,
    );
    const body = parseInput(z.object({ mode: z.enum(AI_MODES) }).strict(), request.body);
    return {
      conversation: await options.ai.switchMode(
        user.id,
        params.conversationId,
        language(user.language),
        body.mode,
      ),
    };
  });

  app.delete('/ai/conversations/:conversationId', async (request, reply) => {
    const { user } = await authenticateRequest(request, options.auth);
    const params = parseInput(
      z.object({ conversationId: conversationIdSchema }).strict(),
      request.params,
    );
    await options.ai.archive(user.id, params.conversationId);
    return reply.status(204).send();
  });

  app.get('/ai/status', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    return options.ai.status(user.id);
  });

  app.post('/ai/conversations/:conversationId/estimate', async (request) => {
    const { user } = await authenticateRequest(request, options.auth);
    const params = parseInput(
      z.object({ conversationId: conversationIdSchema }).strict(),
      request.params,
    );
    const body = parseInput(
      z.object({ content: promptSchema, mode: z.enum(AI_MODES).optional() }).strict(),
      request.body,
    );
    return options.ai.estimate(
      user.id,
      params.conversationId,
      language(user.language),
      body.content,
      body.mode,
    );
  });

  app.post('/ai/conversations/:conversationId/messages', async (request, reply) => {
    const { user } = await authenticateRequest(request, options.auth);
    const params = parseInput(
      z.object({ conversationId: conversationIdSchema }).strict(),
      request.params,
    );
    const body = parseInput(
      z.object({ content: promptSchema, mode: z.enum(AI_MODES).optional() }).strict(),
      request.body,
    );
    const result = await options.ai.send({
      content: body.content,
      conversationId: params.conversationId,
      idempotencyKey: idempotencyKey(request.headers['idempotency-key']),
      language: language(user.language),
      mode: body.mode,
      requestId: request.id,
      telemetry: telemetry(request.log),
      userId: user.id,
    });
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });

  app.post('/ai/conversations/:conversationId/messages/stream', async (request, reply) => {
    const { user } = await authenticateRequest(request, options.auth);
    const params = parseInput(
      z.object({ conversationId: conversationIdSchema }).strict(),
      request.params,
    );
    const body = parseInput(
      z.object({ content: promptSchema, mode: z.enum(AI_MODES).optional() }).strict(),
      request.body,
    );
    const controller = new AbortController();
    let finished = false;
    let chargedMessageId: string | undefined;
    const abort = () => {
      if (!finished) controller.abort();
    };
    request.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    reply.hijack();
    reply.raw.writeHead(200, {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    });

    try {
      await writeSse(reply, 'started', { requestId: request.id });
      const result = await options.ai.send({
        content: body.content,
        conversationId: params.conversationId,
        idempotencyKey: idempotencyKey(request.headers['idempotency-key']),
        language: language(user.language),
        mode: body.mode,
        onDelta: (delta) => writeSse(reply, 'delta', { delta }),
        requestId: request.id,
        signal: controller.signal,
        telemetry: telemetry(request.log),
        userId: user.id,
      });
      chargedMessageId = result.message.id;
      await writeSse(reply, 'completed', result);
      await writeSse(reply, 'done', { requestId: request.id });
      finished = true;
      reply.raw.end();
    } catch (error) {
      if (chargedMessageId && !finished) {
        await options.ai
          .reverseDeliveryFailure(user.id, chargedMessageId)
          .catch((refundError) =>
            request.log.error({ err: refundError }, 'AI delivery reversal failed'),
          );
      }
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
        await writeSse(reply, 'error', { code, requestId: request.id }).catch(() => undefined);
        reply.raw.end();
      }
    } finally {
      finished = true;
      request.raw.off('aborted', abort);
      reply.raw.off('close', abort);
    }
  });
}
