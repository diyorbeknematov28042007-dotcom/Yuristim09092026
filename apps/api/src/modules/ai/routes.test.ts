import type { AiSendResult, AiStatusView } from '@yuristim/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { signInternalRequest } from '../auth/internal-auth.js';
import type { CoreAuthService } from '../auth/service.js';
import type { AiService } from './service.js';

const secret = 'phase7-test-internal-secret-at-least-32-characters';
const telegramUserId = 123_456_789;
const userId = '00000000-0000-4000-8000-000000000001';
const conversationId = 'aic_000000000000000000000001';
const messageId = 'aim_000000000000000000000001';

const status: AiStatusView = {
  activeConversationId: conversationId,
  availability: { expert: true, fast: true },
  balance: {
    bonus: 50,
    lowBalance: false,
    nextExpiry: null,
    paid: 0,
    total: 50,
    weekly: 0,
    zeroBalance: false,
  },
  botChatActive: true,
  mode: 'fast',
};

const sendResult: AiSendResult = {
  conversation: {
    createdAt: '2026-09-17T08:00:00.000Z',
    id: conversationId,
    lastMessageAt: '2026-09-17T08:01:00.000Z',
    mode: 'fast',
    status: 'active',
    title: 'Savol',
    updatedAt: '2026-09-17T08:01:00.000Z',
  },
  duplicate: false,
  message: {
    chargedCredits: 1,
    completedAt: '2026-09-17T08:01:00.000Z',
    content: 'Javob',
    createdAt: '2026-09-17T08:01:00.000Z',
    id: messageId,
    mode: 'fast',
    role: 'assistant',
    sourceStatus: 'none',
    sources: [],
    status: 'completed',
  },
};

function fixture() {
  const getTelegramUserForInternal = vi.fn().mockResolvedValue({ id: userId, language: 'uz' });
  const auth = { getTelegramUserForInternal } as unknown as CoreAuthService;
  const send = vi.fn().mockResolvedValue(sendResult);
  const botStatus = { ...status, telegramControlMessageId: 321 };
  const ai = {
    availability: async () => ({ expert: true, fast: true }),
    providerStatus: vi.fn().mockResolvedValue({
      anthropic: { configured: false, enabled: true, state: 'ACTIVE' },
      bai: { configured: true, enabled: true, state: 'ACTIVE' },
      gemini: { configured: false, enabled: true, state: 'ACTIVE' },
      openai: { configured: false, enabled: true, state: 'OPEN' },
    }),
    send,
    status: vi.fn().mockResolvedValue(status),
    botStatus: vi.fn().mockResolvedValue(botStatus),
    replaceBotController: vi.fn().mockResolvedValue(true),
  } as unknown as AiService;
  const app = buildApp({
    core: {
      aiService: ai,
      internalBotSecret: secret,
      production: false,
      service: auth,
    },
    logger: false,
  });
  return { ai, app, botStatus, getTelegramUserForInternal, send };
}

function signedHeaders(method: string, path: string, body?: unknown) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return {
    'x-yuristim-signature': signInternalRequest(method, path, body, timestamp, secret),
    'x-yuristim-timestamp': timestamp,
  };
}

describe('AI internal bot routes', () => {
  const apps: ReturnType<typeof fixture>['app'][] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('keeps Bot-to-API AI status behind the existing HMAC contract', async () => {
    const { app, botStatus, getTelegramUserForInternal } = fixture();
    apps.push(app);
    const path = `/internal/telegram/users/${telegramUserId}/ai/status`;
    const response = await app.inject({
      headers: signedHeaders('GET', path),
      method: 'GET',
      url: path,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(botStatus);
    expect(getTelegramUserForInternal).toHaveBeenCalledWith(telegramUserId);
  });

  it('atomically replaces controller state behind HMAC without exposing it publicly', async () => {
    const { ai, app } = fixture();
    apps.push(app);
    const path = `/internal/telegram/users/${telegramUserId}/ai/controller`;
    const body = { expectedMessageId: 321, newMessageId: 654 };
    const response = await app.inject({
      headers: signedHeaders('PATCH', path, body),
      method: 'PATCH',
      payload: body,
      url: path,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ replaced: true });
    expect(ai.replaceBotController).toHaveBeenCalledWith(userId, 321, 654);

    const publicResponse = await app.inject({ method: 'GET', url: '/ai/status' });
    expect(publicResponse.body).not.toContain('telegramControlMessageId');
  });

  it('keeps /ready healthy while reporting sanitized partial AI availability', async () => {
    const { app, ai } = fixture();
    apps.push(app);
    vi.spyOn(ai, 'availability').mockResolvedValue({ expert: true, fast: false });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      dependencies: { ai: { expert: true, fast: false } },
      status: 'ready',
    });
  });

  it('rejects an invalid HMAC before resolving the Telegram user', async () => {
    const { app, getTelegramUserForInternal } = fixture();
    apps.push(app);
    const path = `/internal/telegram/users/${telegramUserId}/ai/status`;
    const response = await app.inject({
      headers: {
        'x-yuristim-signature': 'sha256=invalid',
        'x-yuristim-timestamp': String(Math.floor(Date.now() / 1_000)),
      },
      method: 'GET',
      url: path,
    });
    expect(response.statusCode).toBe(401);
    expect(getTelegramUserForInternal).not.toHaveBeenCalled();
  });

  it('returns sanitized provider state only through HMAC-protected internal status', async () => {
    const { app } = fixture();
    apps.push(app);
    const path = '/internal/ai/providers/status';
    const response = await app.inject({
      headers: signedHeaders('GET', path),
      method: 'GET',
      url: path,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      providers: {
        bai: { configured: true, enabled: true, state: 'ACTIVE' },
        openai: { configured: false, enabled: true, state: 'OPEN' },
      },
    });
    expect(response.body).not.toMatch(/api.?key|secret|prefix|length/i);
  });

  it.each(['', 'x'.repeat(12_001)])('rejects an empty or oversized AI prompt', async (content) => {
    const { app, send } = fixture();
    apps.push(app);
    const path = `/internal/telegram/users/${telegramUserId}/ai/conversations/${conversationId}/messages`;
    const body = { content, idempotencyKey: 'telegram:request:1' };
    const response = await app.inject({
      headers: signedHeaders('POST', path, body),
      method: 'POST',
      payload: body,
      url: path,
    });
    expect(response.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('forwards a validated idempotency key and returns only public AI metadata', async () => {
    const { app, send } = fixture();
    apps.push(app);
    const path = `/internal/telegram/users/${telegramUserId}/ai/conversations/${conversationId}/messages`;
    const body = { content: 'Savol', idempotencyKey: 'telegram:request:2' };
    const response = await app.inject({
      headers: signedHeaders('POST', path, body),
      method: 'POST',
      payload: body,
      url: path,
    });
    expect(response.statusCode).toBe(201);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        idempotencyKey: body.idempotencyKey,
        userId,
      }),
    );
    expect(response.body).not.toContain('provider');
    expect(response.body).not.toContain('model');
    expect(response.body).not.toContain('systemPrompt');
  });
});
