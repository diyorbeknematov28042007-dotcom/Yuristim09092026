import type { UserRow } from '@yuristim/db';
import type { UserView } from '@yuristim/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { signInternalRequest } from '../auth/internal-auth.js';
import type { CoreAuthService } from '../auth/service.js';
import type { AiService } from '../ai/service.js';
import type { LawyerService } from '../lawyers/service.js';
import type { MarketplaceService } from '../marketplace/service.js';

const secret = 'runtime-context-test-secret-at-least-32-characters';
const telegramUserId = 123_456_789;
const path = `/internal/telegram/users/${telegramUserId}/runtime-context`;
const user = { id: '00000000-0000-4000-8000-000000000001' } as UserRow;
const userView = {
  activeMode: 'lawyer',
  createdAt: '2026-09-09T10:00:00.000Z',
  duid: 'yr_abcdefghijklmnop',
  fullName: 'Private Name',
  id: user.id,
  language: 'uz',
  onboardingRole: 'lawyer',
  onboardingStatus: 'completed',
  status: 'active',
  telegramFirstName: 'Private First Name',
  telegramUserId: String(telegramUserId),
  telegramUsername: 'private_username',
  termsAcceptedAt: '2026-09-09T10:00:00.000Z',
  termsVersion: '2026-09',
  updatedAt: '2026-09-09T10:00:00.000Z',
} satisfies UserView;

function signedHeaders(route = path) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return {
    'x-yuristim-signature': signInternalRequest('GET', route, undefined, timestamp, secret),
    'x-yuristim-timestamp': timestamp,
  };
}

function fixture() {
  const getTelegramUserForInternal = vi.fn().mockResolvedValue(user);
  const getTelegramUserContext = vi.fn().mockResolvedValue({ hasPin: true, user: userView });
  const auth = {
    getTelegramUserContext,
    getTelegramUserForInternal,
    toUserView: vi.fn(() => userView),
  } as unknown as CoreAuthService;
  const getBotRoutingState = vi.fn().mockResolvedValue({
    draftStep: 'bio',
    verificationStatus: 'draft',
  });
  const lawyers = { getBotRoutingState } as unknown as LawyerService;
  const getDraft = vi.fn().mockResolvedValue({
    additionalDetails: null,
    description: 'Private marketplace description',
    region: null,
    specializationCode: 'civil',
    step: 'region',
  });
  const marketplace = { getDraft } as unknown as MarketplaceService;
  const botRoutingState = vi.fn().mockResolvedValue({
    activeConversationId: 'aic_000000000000000000000001',
    botChatActive: true,
    mode: 'fast',
    telegramControlMessageId: 321,
  });
  const ai = {
    availability: vi.fn().mockResolvedValue({ expert: true, fast: true }),
    botRoutingState,
  } as unknown as AiService;
  const app = buildApp({
    core: {
      aiService: ai,
      internalBotSecret: secret,
      lawyerService: lawyers,
      marketplaceService: marketplace,
      production: false,
      service: auth,
    },
    logger: false,
  });
  return {
    ai,
    app,
    auth,
    botRoutingState,
    getBotRoutingState,
    getDraft,
    getTelegramUserContext,
    getTelegramUserForInternal,
  };
}

describe('internal Telegram runtime context', () => {
  const apps: ReturnType<typeof fixture>['app'][] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('returns only minimal routing state while preserving all routing decisions', async () => {
    const { app } = fixture();
    apps.push(app);
    const response = await app.inject({ headers: signedHeaders(), method: 'GET', url: path });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ai: {
        activeConversationId: 'aic_000000000000000000000001',
        botChatActive: true,
        mode: 'fast',
        telegramControlMessageId: 321,
      },
      lawyer: { draftStep: 'bio', verificationStatus: 'draft' },
      marketplace: { draftStep: 'region' },
      user: {
        activeMode: 'lawyer',
        language: 'uz',
        onboardingRole: 'lawyer',
        onboardingStatus: 'completed',
      },
    });
    expect(response.body).not.toMatch(/Private|duid|telegramUsername|description|balance|history/i);
  });

  it('starts independent lawyer, marketplace, and AI reads concurrently', async () => {
    const { app, botRoutingState, getBotRoutingState, getDraft } = fixture();
    apps.push(app);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    getBotRoutingState.mockImplementation(async () => {
      await gate;
      return { draftStep: null, verificationStatus: null };
    });
    getDraft.mockImplementation(async () => {
      await gate;
      return null;
    });
    botRoutingState.mockImplementation(async () => {
      await gate;
      return {
        activeConversationId: null,
        botChatActive: false,
        mode: 'fast',
        telegramControlMessageId: null,
      };
    });

    const responsePromise = app.inject({ headers: signedHeaders(), method: 'GET', url: path });
    await vi.waitFor(() => {
      expect(getBotRoutingState).toHaveBeenCalledOnce();
      expect(getDraft).toHaveBeenCalledOnce();
      expect(botRoutingState).toHaveBeenCalledOnce();
    });
    release();
    expect((await responsePromise).statusCode).toBe(200);
  });

  it('rejects missing HMAC before any user or routing read', async () => {
    const { app, getBotRoutingState, getDraft, getTelegramUserForInternal } = fixture();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(401);
    expect(getTelegramUserForInternal).not.toHaveBeenCalled();
    expect(getBotRoutingState).not.toHaveBeenCalled();
    expect(getDraft).not.toHaveBeenCalled();
  });

  it('leaves the existing user-context route compatible', async () => {
    const { app, getTelegramUserContext } = fixture();
    apps.push(app);
    const contextPath = `/internal/telegram/users/${telegramUserId}/context`;
    const response = await app.inject({
      headers: signedHeaders(contextPath),
      method: 'GET',
      url: contextPath,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hasPin: true, user: userView });
    expect(getTelegramUserContext).toHaveBeenCalledWith(telegramUserId);
  });
});
