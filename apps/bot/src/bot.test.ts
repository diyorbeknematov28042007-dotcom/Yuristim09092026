import type {
  AiConversationView,
  AiMessageView,
  AiSendResult,
  AiStatusView,
  BotLawyerContext,
  BotOnboardingAction,
  BotUserContext,
  BotVerificationAction,
  CreditBalanceView,
  CreditProductView,
  CreditTransactionPage,
  LawyerProfileView,
  LawyerVerificationView,
  MarketplaceAcceptBalanceView,
  MarketplaceAcceptProductView,
  UserView,
} from '@yuristim/types';
import type { Update, UserFromGetMe } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import {
  YuristimApiError,
  type EnsureUserResult,
  type YuristimApi,
} from './api/yuristim-api.client.js';
import { createBot } from './bot.js';
import { t } from './i18n/index.js';
import { mainLawyerKeyboard } from './keyboards/main-lawyer.keyboard.js';
import { mainUserKeyboard } from './keyboards/main-user.keyboard.js';
import { servicesKeyboard } from './keyboards/services.keyboard.js';
import { telegramChunks } from './services/ai.service.js';
import { displayName } from './services/user-context.service.js';

const botInfo = {
  can_join_groups: true,
  can_read_all_group_messages: false,
  first_name: 'Yuristim',
  id: 999,
  is_bot: true,
  supports_inline_queries: false,
  username: 'yuristim_test_bot',
} as UserFromGetMe;

function user(overrides: Partial<UserView> = {}): UserView {
  return {
    activeMode: 'user',
    createdAt: '2026-09-09T10:00:00.000Z',
    duid: 'yr_abcdefghijklmnop',
    fullName: null,
    id: '00000000-0000-4000-8000-000000000001',
    language: null,
    onboardingRole: null,
    onboardingStatus: 'language_selection',
    status: 'active',
    telegramFirstName: 'Diyorbek',
    telegramUserId: '123456789',
    telegramUsername: 'diyorbek',
    termsAcceptedAt: null,
    termsVersion: null,
    updatedAt: '2026-09-09T10:00:00.000Z',
    ...overrides,
  };
}

class FakeApi implements YuristimApi {
  actions: BotOnboardingAction[] = [];
  created = true;
  requestedTelegramIds: number[] = [];
  data: BotUserContext = { hasPin: false, user: user() };
  ensuredTelegramIds: number[] = [];
  lawyer: BotLawyerContext = { profile: null, specializations: [], verification: null };
  verificationActions: BotVerificationAction[] = [];
  uploads: Array<{ kind: string }> = [];
  creditBalance: CreditBalanceView = {
    bonus: 50,
    lowBalance: false,
    nextExpiry: '2026-09-14T19:00:00.000Z',
    paid: 0,
    total: 62,
    weekly: 12,
    zeroBalance: false,
  };
  creditHistory: CreditTransactionPage = {
    items: [
      {
        amount: 50,
        balanceAfter: 50,
        bucketType: 'bonus',
        createdAt: '2026-09-09T10:00:00.000Z',
        expiresAt: null,
        id: '30000000-0000-4000-8000-000000000001',
        reason: 'Welcome',
        type: 'welcome_bonus',
      },
    ],
    limit: 5,
    page: 1,
    total: 1,
  };
  creditProducts: CreditProductView[] = [];
  acceptBalance: MarketplaceAcceptBalanceView = { balance: 2, nextExpiry: null };
  acceptProducts: MarketplaceAcceptProductView[] = [
    {
      acceptCount: 1,
      code: 'single_accept',
      currency: 'UZS',
      expiresInDays: null,
      id: '40000000-0000-4000-8000-000000000001',
      name: '1 qabul',
      price: 9900,
    },
  ];
  aiConversations: AiConversationView[] = [
    {
      createdAt: '2026-09-17T08:00:00.000Z',
      id: 'aic_000000000000000000000001',
      lastMessageAt: null,
      mode: 'fast',
      status: 'active',
      title: 'Yangi chat',
      updatedAt: '2026-09-17T08:00:00.000Z',
    },
  ];
  aiMessages: AiMessageView[] = [];
  aiStatus: AiStatusView = {
    activeConversationId: 'aic_000000000000000000000001',
    availability: { expert: true, fast: true },
    balance: this.creditBalance,
    botChatActive: false,
    mode: 'fast',
  };
  aiDeliveryFailures: string[] = [];

  ensureTelegramUser(identity: { telegramUserId: number }): Promise<EnsureUserResult> {
    this.ensuredTelegramIds.push(identity.telegramUserId);
    return Promise.resolve({ created: this.created, user: this.data.user });
  }

  getTelegramUserContext(telegramUserId: number): Promise<BotUserContext> {
    this.requestedTelegramIds.push(telegramUserId);
    return Promise.resolve(this.data);
  }

  updateOnboarding(telegramUserId: number, action: BotOnboardingAction): Promise<BotUserContext> {
    this.requestedTelegramIds.push(telegramUserId);
    this.actions.push(action);
    const current = this.data.user;
    switch (action.action) {
      case 'set_language':
        this.data.user = {
          ...current,
          language: action.language,
          onboardingStatus:
            current.onboardingStatus === 'completed' ? 'completed' : 'role_selection',
        };
        break;
      case 'set_role':
        this.data.user = {
          ...current,
          activeMode: 'user',
          onboardingRole: action.role,
          onboardingStatus:
            action.role === 'lawyer' && !current.fullName
              ? 'name_required'
              : current.termsAcceptedAt
                ? 'completed'
                : 'terms_acceptance',
        };
        break;
      case 'set_full_name':
        this.data.user = {
          ...current,
          fullName: action.fullName,
          onboardingStatus: current.termsAcceptedAt ? 'completed' : 'terms_acceptance',
        };
        break;
      case 'accept_terms':
        this.data.user = {
          ...current,
          onboardingStatus: 'completed',
          termsAcceptedAt: '2026-09-09T10:05:00.000Z',
          termsVersion: action.termsVersion,
        };
        break;
      case 'reset':
        this.data.user = user({ duid: current.duid, id: current.id });
    }
    return Promise.resolve(this.data);
  }

  getLawyerContext(): Promise<BotLawyerContext> {
    return Promise.resolve(this.lawyer);
  }

  updateVerification(
    _telegramUserId: number,
    action: BotVerificationAction,
  ): Promise<BotLawyerContext['verification']> {
    this.verificationActions.push(action);
    if (action.action === 'start') {
      this.lawyer.verification = verification({ type: action.type ?? 'initial' });
    } else if (action.action === 'cancel') {
      this.lawyer.verification = null;
    } else if (this.lawyer.verification) {
      const draft = { ...this.lawyer.verification.draft };
      if (action.action === 'set_full_name') {
        draft.fullName = action.fullName;
        draft.step = 'region';
      }
      if (action.action === 'set_region') {
        draft.region = action.region;
        draft.step = 'specializations';
      }
      if (action.action === 'toggle_specialization') draft.specializationCodes = [action.code];
      if (action.action === 'finish_specializations') draft.step = 'experience';
      if (action.action === 'set_experience') {
        draft.experienceYears = action.experienceYears;
        draft.step = 'bio';
      }
      if (action.action === 'set_bio') {
        draft.bio = action.bio;
        draft.step = 'price';
      }
      if (action.action === 'set_price') {
        draft.consultationPrice = action.consultationPrice;
        draft.step = 'profile_image';
      }
      if (action.action === 'set_profile_image') {
        draft.profileImagePath = action.path;
        draft.step = 'verification_document';
      }
      if (action.action === 'add_verification_document') {
        draft.verificationDocumentPaths = [action.path];
        draft.step = 'summary';
      }
      this.lawyer.verification = {
        ...this.lawyer.verification,
        draft,
        status: action.action === 'submit' ? 'pending_review' : 'draft',
      };
    }
    return Promise.resolve(this.lawyer.verification);
  }

  uploadVerificationFile(
    _telegramUserId: number,
    input: { kind: 'profile_image' | 'verification_document' },
  ): Promise<{ path: string }> {
    this.uploads.push(input);
    const path = input.kind === 'profile_image' ? 'test/avatar.jpg' : 'test/license.pdf';
    return this.updateVerification(
      _telegramUserId,
      input.kind === 'profile_image'
        ? { action: 'set_profile_image', path }
        : { action: 'add_verification_document', path },
    ).then(() => ({ path }));
  }

  switchMode(_telegramUserId: number, mode: 'user' | 'lawyer'): Promise<UserView> {
    this.data.user = { ...this.data.user, activeMode: mode };
    return Promise.resolve(this.data.user);
  }

  getCreditBalance(): Promise<CreditBalanceView> {
    return Promise.resolve(this.creditBalance);
  }

  getCreditHistory(): Promise<CreditTransactionPage> {
    return Promise.resolve(this.creditHistory);
  }

  getCreditProducts(): Promise<CreditProductView[]> {
    return Promise.resolve(this.creditProducts);
  }

  getAcceptBalance(): Promise<MarketplaceAcceptBalanceView> {
    return Promise.resolve(this.acceptBalance);
  }

  getAcceptProducts(): Promise<MarketplaceAcceptProductView[]> {
    return Promise.resolve(this.acceptProducts);
  }

  enterAi(): Promise<{ conversation: AiConversationView; status: AiStatusView }> {
    this.aiStatus = { ...this.aiStatus, botChatActive: true };
    return Promise.resolve({ conversation: this.aiConversations[0]!, status: this.aiStatus });
  }

  leaveAi(): Promise<void> {
    this.aiStatus = { ...this.aiStatus, botChatActive: false };
    return Promise.resolve();
  }

  getAiStatus(): Promise<AiStatusView> {
    return Promise.resolve(this.aiStatus);
  }

  getAiConversations(): Promise<AiConversationView[]> {
    return Promise.resolve(this.aiConversations);
  }

  createAiConversation(
    _telegramUserId: number,
    mode: 'fast' | 'expert',
  ): Promise<AiConversationView> {
    const conversation: AiConversationView = {
      createdAt: '2026-09-17T08:01:00.000Z',
      id: `aic_${String(this.aiConversations.length + 1).padStart(24, '0')}`,
      lastMessageAt: null,
      mode,
      status: 'active',
      title: 'Yangi chat',
      updatedAt: '2026-09-17T08:01:00.000Z',
    };
    this.aiConversations.push(conversation);
    this.aiMessages = [];
    this.aiStatus = {
      ...this.aiStatus,
      activeConversationId: conversation.id,
      botChatActive: true,
      mode,
    };
    return Promise.resolve(conversation);
  }

  getAiConversation(
    _telegramUserId: number,
    conversationId: string,
  ): Promise<{ conversation: AiConversationView; messages: AiMessageView[] }> {
    return Promise.resolve({
      conversation: this.aiConversations.find((item) => item.id === conversationId)!,
      messages: this.aiMessages,
    });
  }

  resumeAiConversation(
    _telegramUserId: number,
    conversationId: string,
  ): Promise<AiConversationView> {
    const conversation = this.aiConversations.find((item) => item.id === conversationId)!;
    this.aiStatus = {
      ...this.aiStatus,
      activeConversationId: conversation.id,
      botChatActive: true,
      mode: conversation.mode,
    };
    return Promise.resolve(conversation);
  }

  switchAiMode(
    _telegramUserId: number,
    conversationId: string,
    mode: 'fast' | 'expert',
  ): Promise<AiConversationView> {
    const conversation = this.aiConversations.find((item) => item.id === conversationId)!;
    conversation.mode = mode;
    this.aiStatus = { ...this.aiStatus, mode };
    return Promise.resolve(conversation);
  }

  sendAiMessage(
    _telegramUserId: number,
    conversationId: string,
    content: string,
  ): Promise<AiSendResult> {
    const conversation = this.aiConversations.find((item) => item.id === conversationId)!;
    const userMessage: AiMessageView = {
      chargedCredits: 0,
      completedAt: '2026-09-17T08:02:00.000Z',
      content,
      createdAt: '2026-09-17T08:02:00.000Z',
      id: 'aim_000000000000000000000001',
      mode: conversation.mode,
      role: 'user',
      sourceStatus: 'none',
      sources: [],
      status: 'completed',
    };
    const assistantMessage: AiMessageView = {
      ...userMessage,
      chargedCredits: 1,
      content: 'Sinov AI javobi',
      id: 'aim_000000000000000000000002',
      role: 'assistant',
    };
    this.aiMessages.push(userMessage, assistantMessage);
    return Promise.resolve({ conversation, duplicate: false, message: assistantMessage });
  }

  reportAiDeliveryFailure(_telegramUserId: number, messageId: string): Promise<void> {
    this.aiDeliveryFailures.push(messageId);
    return Promise.resolve();
  }
}

function verification(overrides: Partial<LawyerVerificationView> = {}): LawyerVerificationView {
  return {
    draft: { step: 'full_name' },
    id: '10000000-0000-4000-8000-000000000001',
    rejectReason: null,
    reviewedAt: null,
    status: 'draft',
    submittedAt: null,
    type: 'initial',
    ...overrides,
  };
}

function lawyerProfile(overrides: Partial<LawyerProfileView> = {}): LawyerProfileView {
  return {
    bio: 'Professional lawyer biography',
    consultationPrice: null,
    createdAt: '2026-09-10T00:00:00Z',
    currency: 'UZS',
    duid: 'yr_abcdefghijklmnop',
    experienceYears: 5,
    fullName: 'Diyorbek Nematov',
    id: '20000000-0000-4000-8000-000000000001',
    jobsCount: 0,
    profileImageUrl: null,
    publicSlug: 'yr_abcdefghijklmnop',
    ratingAverage: 0,
    ratingCount: 0,
    region: 'Toshkent',
    specializations: [],
    telegramUsername: 'diyorbek',
    verificationStatus: 'approved',
    verifiedAt: '2026-09-10T00:00:00Z',
    ...overrides,
  };
}

interface TelegramCall {
  method: string;
  payload: Record<string, unknown>;
}

function fixture(api = new FakeApi()) {
  const bot = createBot({
    api,
    apiBaseUrl: 'http://localhost:3001',
    botInfo,
    internalApiSecret: 'test-internal-api-secret-32-characters',
    marketplaceChannelId: -1000000000001,
    marketplaceChannelUrl: 'https://t.me/test_marketplace',
    termsVersion: '2026-09',
    token: 'test-token',
    fetch: () => Promise.resolve(new Response(Buffer.from('%PDF-1.4 test'))),
  });
  const calls: TelegramCall[] = [];
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'sendMessage') {
      return {
        ok: true,
        result: {
          chat: { first_name: 'Diyorbek', id: 123_456_789, type: 'private' },
          date: 1_789_000_000,
          from: botInfo,
          message_id: calls.length,
          text: String((payload as { text?: string }).text ?? ''),
        },
      } as never;
    }
    if (method === 'getFile') {
      return {
        ok: true,
        result: {
          file_id: 'file',
          file_path: 'documents/file.pdf',
          file_size: 100,
          file_unique_id: 'unique',
        },
      } as never;
    }
    return { ok: true, result: true } as never;
  });
  return { api, bot, calls };
}

const telegramUser = {
  first_name: 'Diyorbek',
  id: 123_456_789,
  is_bot: false,
  username: 'diyorbek',
} as const;
const chat = { first_name: 'Diyorbek', id: 123_456_789, type: 'private' } as const;

function startUpdate(updateId = 1): Update {
  return {
    message: {
      chat,
      date: 1_789_000_000,
      entities: [{ length: 6, offset: 0, type: 'bot_command' }],
      from: telegramUser,
      message_id: updateId,
      text: '/start',
    },
    update_id: updateId,
  };
}

function callbackUpdate(data: string, updateId: number): Update {
  return {
    callback_query: {
      chat_instance: 'test-chat',
      data,
      from: telegramUser,
      id: `callback-${updateId}`,
      message: {
        chat,
        date: 1_789_000_000,
        from: botInfo,
        message_id: updateId,
        text: 'previous',
      },
    },
    update_id: updateId,
  };
}

function textUpdate(text: string, updateId: number): Update {
  return {
    message: {
      chat,
      date: 1_789_000_000,
      from: telegramUser,
      message_id: updateId,
      text,
    },
    update_id: updateId,
  };
}

function documentUpdate(
  updateId: number,
  mimeType = 'application/pdf',
  filename = 'license.pdf',
): Update {
  return {
    message: {
      chat,
      date: 1_789_000_000,
      document: {
        file_id: 'file',
        file_name: filename,
        file_size: 100,
        file_unique_id: 'unique',
        mime_type: mimeType,
      },
      from: telegramUser,
      message_id: updateId,
    },
    update_id: updateId,
  };
}

function texts(calls: TelegramCall[]): string[] {
  return calls
    .filter((call) => ['sendMessage', 'editMessageText'].includes(call.method))
    .map((call) => String(call.payload.text));
}

function replyKeyboardLabels(keyboard: unknown): string[] {
  const markup = JSON.parse(JSON.stringify(keyboard)) as {
    keyboard: Array<Array<{ text: string }>>;
  };
  return markup.keyboard.flat().map((button) => button.text);
}

function inlineKeyboardLabels(keyboard: unknown): string[] {
  const markup = JSON.parse(JSON.stringify(keyboard)) as {
    inline_keyboard: Array<Array<{ text: string }>>;
  };
  return markup.inline_keyboard.flat().map((button) => button.text);
}

describe('/start', () => {
  it('starts a new user at language selection', async () => {
    const { api, bot, calls } = fixture();
    await bot.handleUpdate(startUpdate(), botInfo);
    expect(texts(calls)).toContain(t('uz', 'chooseLanguage'));
    expect(api.ensuredTelegramIds).toEqual([telegramUser.id]);
  });

  it('opens the localized main menu for a returning user', async () => {
    const api = new FakeApi();
    api.created = false;
    api.data.user = user({ language: 'ru', onboardingRole: 'user', onboardingStatus: 'completed' });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(startUpdate(), botInfo);
    expect(texts(calls)).toContain(t('ru', 'mainTitle'));
  });

  it('offers resume for unfinished onboarding and reports blocked users', async () => {
    const api = new FakeApi();
    api.created = false;
    api.data.user = user({ language: 'en', onboardingStatus: 'role_selection' });
    const first = fixture(api);
    await first.bot.handleUpdate(startUpdate(), botInfo);
    expect(texts(first.calls)).toContain(t('en', 'resumePrompt'));

    api.data.user = user({ status: 'blocked' });
    const blocked = fixture(api);
    await blocked.bot.handleUpdate(startUpdate(2), botInfo);
    expect(texts(blocked.calls)).toContain(t(null, 'blocked'));
  });

  it('continues unfinished onboarding from persisted backend state', async () => {
    const api = new FakeApi();
    api.created = false;
    api.data.user = user({ language: 'en', onboardingStatus: 'role_selection' });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(callbackUpdate('onboarding:continue', 3), botInfo);
    expect(texts(calls)).toContain(t('en', 'chooseRole'));
  });
});

describe('onboarding', () => {
  it.each(['uz', 'ru', 'en'] as const)(
    'persists %s language from a validated callback',
    async (language) => {
      const { api, bot } = fixture();
      await bot.handleUpdate(callbackUpdate(`lang:${language}`, 10), botInfo);
      expect(api.actions).toContainEqual({ action: 'set_language', language });
      expect(api.requestedTelegramIds.every((id) => id === telegramUser.id)).toBe(true);
    },
  );

  it('completes the user flow without asking for a full name', async () => {
    const { api, bot, calls } = fixture();
    await bot.handleUpdate(callbackUpdate('lang:uz', 20), botInfo);
    await bot.handleUpdate(callbackUpdate('role:user', 21), botInfo);
    await bot.handleUpdate(callbackUpdate('terms:accept', 22), botInfo);
    expect(api.actions.some((action) => action.action === 'set_full_name')).toBe(false);
    expect(api.data.user.onboardingStatus).toBe('completed');
    expect(texts(calls)).toContain(t('uz', 'mainTitle'));
  });

  it('requires a valid lawyer name and keeps active mode user', async () => {
    const { api, bot, calls } = fixture();
    await bot.handleUpdate(callbackUpdate('lang:uz', 30), botInfo);
    await bot.handleUpdate(callbackUpdate('role:lawyer', 31), botInfo);
    await bot.handleUpdate(textUpdate('   ', 32), botInfo);
    expect(texts(calls)).toContain(t('uz', 'nameInvalid'));
    await bot.handleUpdate(textUpdate('Ne’matov Diyorbek Dilshidjon o‘g‘li', 33), botInfo);
    await bot.handleUpdate(callbackUpdate('terms:accept', 34), botInfo);
    expect(api.data.user.fullName).toBe('Ne’matov Diyorbek Dilshidjon o‘g‘li');
    expect(api.data.user.activeMode).toBe('user');
    expect(texts(calls)).toContain(t('uz', 'lawyerInfo'));
  });

  it('resets progress without changing account or DUID', async () => {
    const api = new FakeApi();
    api.created = false;
    api.data.user = user({ language: 'ru', onboardingStatus: 'role_selection' });
    const original = { duid: api.data.user.duid, id: api.data.user.id };
    const { bot } = fixture(api);
    await bot.handleUpdate(callbackUpdate('onboarding:reset', 40), botInfo);
    expect(api.data.user).toMatchObject(original);
    expect(api.data.user.onboardingStatus).toBe('language_selection');
  });
});

describe('menus and callback security', () => {
  it.each(['uz', 'ru', 'en'] as const)(
    'keeps the relocated main actions and service menu consistent in %s',
    (language) => {
      const userLabels = replyKeyboardLabels(mainUserKeyboard(language));
      expect(userLabels).toHaveLength(6);
      expect(userLabels).toEqual([
        t(language, 'ai'),
        t(language, 'findLawyer'),
        t(language, 'services'),
        t(language, 'balance'),
        t(language, 'settings'),
        t(language, 'questions'),
      ]);

      const serviceLabels = inlineKeyboardLabels(servicesKeyboard(language));
      expect(serviceLabels).not.toContain(t(language, 'findLawyer'));
      expect(serviceLabels).toEqual([
        t(language, 'documentSamples'),
        t(language, 'legalLibrary'),
        t(language, 'createDocument'),
        t(language, 'back'),
      ]);

      const lawyerLabels = replyKeyboardLabels(mainLawyerKeyboard(language));
      expect(lawyerLabels).toHaveLength(6);
      expect(lawyerLabels).toEqual([
        t(language, 'ai'),
        t(language, 'findClients'),
        t(language, 'services'),
        t(language, 'marketplace'),
        t(language, 'balance'),
        t(language, 'settings'),
      ]);
    },
  );

  it('renders navigation and clean feature shells', async () => {
    const api = new FakeApi();
    api.data.user = user({ language: 'en', onboardingRole: 'user', onboardingStatus: 'completed' });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(textUpdate(t('en', 'findLawyer'), 49), botInfo);
    await bot.handleUpdate(textUpdate(t('en', 'services'), 50), botInfo);
    await bot.handleUpdate(callbackUpdate('service:create-document', 51), botInfo);
    await bot.handleUpdate(textUpdate(t('en', 'settings'), 52), botInfo);
    await bot.handleUpdate(textUpdate(t('en', 'questions'), 53), botInfo);
    expect(texts(calls)).toEqual(
      expect.arrayContaining([
        t('en', 'marketplaceUserTitle'),
        t('en', 'servicesTitle'),
        t('en', 'documentLater'),
        t('en', 'settingsTitle'),
        t('en', 'questionsTitle'),
      ]),
    );
  });

  it('renders the localized client-discovery shell in lawyer mode', async () => {
    const api = new FakeApi();
    api.data.user = user({
      activeMode: 'lawyer',
      language: 'ru',
      onboardingRole: 'lawyer',
      onboardingStatus: 'completed',
    });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(textUpdate(t('ru', 'findClients'), 54), botInfo);
    expect(texts(calls)).toContain(t('ru', 'marketplaceFindClientsText'));
  });

  it.each(['uz', 'ru', 'en'] as const)(
    'renders balance, product, and five-item history navigation in %s',
    async (language) => {
      const api = new FakeApi();
      api.data.user = user({ language, onboardingRole: 'user', onboardingStatus: 'completed' });
      const { bot, calls } = fixture(api);
      await bot.handleUpdate(textUpdate(t(language, 'balance'), 55), botInfo);
      await bot.handleUpdate(callbackUpdate('credits:buy', 56), botInfo);
      await bot.handleUpdate(callbackUpdate('credits:history', 57), botInfo);
      await bot.handleUpdate(callbackUpdate('credits:all-plans', 58), botInfo);
      expect(texts(calls).join('\n')).toContain(t(language, 'totalBalance'));
      expect(texts(calls)).toContain(
        `${t(language, 'creditProductsTitle')}\n\n${t(language, 'noActiveCreditProducts')}`,
      );
      expect(texts(calls).join('\n')).toContain(t(language, 'creditTypeWelcomeBonus'));
      expect(texts(calls)).toContain(t(language, 'plansUnavailable'));
    },
  );

  it('renders accept units for an approved lawyer', async () => {
    const api = new FakeApi();
    api.data.user = user({
      activeMode: 'lawyer',
      language: 'uz',
      onboardingRole: 'lawyer',
      onboardingStatus: 'completed',
    });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(callbackUpdate('credits:accepts', 59), botInfo);
    expect(texts(calls).join('\n')).toContain(`${t('uz', 'acceptUnits')}: 2`);
    expect(texts(calls).join('\n')).toContain('9 900 UZS');
  });

  it('rejects malformed callbacks and defines the lawyer menu renderer', async () => {
    const { api, bot, calls } = fixture();
    await bot.handleUpdate(callbackUpdate('lang:uz:999999', 60), botInfo);
    expect(api.actions).toHaveLength(0);
    expect(calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true);
    expect(JSON.stringify(mainLawyerKeyboard('uz'))).toContain(t('uz', 'marketplace'));
  });

  it('updates settings language and renders profile from backend data', async () => {
    const api = new FakeApi();
    api.data.user = user({ language: 'uz', onboardingRole: 'user', onboardingStatus: 'completed' });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(callbackUpdate('settings:profile', 70), botInfo);
    await bot.handleUpdate(callbackUpdate('settings:language', 71), botInfo);
    await bot.handleUpdate(callbackUpdate('lang:ru', 72), botInfo);
    expect(texts(calls).some((text) => text.includes(api.data.user.duid))).toBe(true);
    expect(api.data.user.language).toBe('ru');
    expect(api.data.user.onboardingStatus).toBe('completed');
  });

  it('does not show the lawyer menu to an unverified lawyer-intention user', async () => {
    const api = new FakeApi();
    api.created = false;
    api.data.user = user({
      activeMode: 'user',
      fullName: 'Diyorbek Nematov',
      language: 'uz',
      onboardingRole: 'lawyer',
      onboardingStatus: 'completed',
    });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(startUpdate(80), botInfo);
    const payload = JSON.stringify(calls.find((call) => call.method === 'sendMessage')?.payload);
    expect(payload).not.toContain(t('uz', 'marketplace'));
    expect(payload).toContain(t('uz', 'questions'));
  });

  it('returns to the main menu through validated back navigation', async () => {
    const api = new FakeApi();
    api.data.user = user({ language: 'uz', onboardingRole: 'user', onboardingStatus: 'completed' });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(callbackUpdate('nav:main', 90), botInfo);
    expect(texts(calls)).toContain(t('uz', 'mainTitle'));
  });

  it('uses username then first name as non-identity display fallbacks', () => {
    expect(displayName(user({ fullName: null, telegramUsername: 'diyorbek' }))).toBe('@diyorbek');
    expect(
      displayName(user({ fullName: null, telegramFirstName: 'Diyorbek', telegramUsername: null })),
    ).toBe('Diyorbek');
  });

  it('maps API failure to safe localized UX without exposing technical detail', async () => {
    const api = new FakeApi();
    api.getTelegramUserContext = () => Promise.reject(new YuristimApiError('API_UNAVAILABLE', 503));
    const errorLog = console.error;
    console.error = () => undefined;
    try {
      const { bot, calls } = fixture(api);
      await bot.handleUpdate(textUpdate('hello', 100), botInfo);
      expect(texts(calls)).toContain(t('uz', 'apiError'));
      expect(texts(calls).join(' ')).not.toContain('API_UNAVAILABLE');
    } finally {
      console.error = errorLog;
    }
  });
});

describe('lawyer verification', () => {
  it('persists every verification step, uploads bounded files, and submits', async () => {
    const api = new FakeApi();
    api.data.user = user({
      fullName: 'Diyorbek Nematov',
      language: 'uz',
      onboardingRole: 'lawyer',
      onboardingStatus: 'completed',
    });
    api.lawyer.specializations = [
      { code: 'civil', id: '30000000-0000-4000-8000-000000000001', name: 'Fuqarolik huquqi' },
    ];
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(callbackUpdate('settings:lawyer-profile', 110), botInfo);
    await bot.handleUpdate(callbackUpdate('verify:start', 111), botInfo);
    await bot.handleUpdate(textUpdate('Diyorbek Nematov', 112), botInfo);
    await bot.handleUpdate(textUpdate('Toshkent shahri', 113), botInfo);
    await bot.handleUpdate(callbackUpdate('verify:spec:civil', 114), botInfo);
    await bot.handleUpdate(callbackUpdate('verify:spec-done', 115), botInfo);
    await bot.handleUpdate(textUpdate('5', 116), botInfo);
    await bot.handleUpdate(
      textUpdate('Fuqarolik huquqi bo‘yicha professional yuristman.', 117),
      botInfo,
    );
    await bot.handleUpdate(callbackUpdate('verify:price-skip', 118), botInfo);
    await bot.handleUpdate(documentUpdate(119, 'image/jpeg', 'avatar.jpg'), botInfo);
    await bot.handleUpdate(documentUpdate(120), botInfo);
    await bot.handleUpdate(callbackUpdate('verify:submit', 121), botInfo);
    expect(api.verificationActions.map((action) => action.action)).toEqual(
      expect.arrayContaining([
        'start',
        'set_full_name',
        'set_region',
        'toggle_specialization',
        'finish_specializations',
        'set_experience',
        'set_bio',
        'set_price',
        'submit',
      ]),
    );
    expect(api.uploads.map((upload) => upload.kind)).toEqual([
      'profile_image',
      'verification_document',
    ]);
    expect(api.lawyer.verification?.status).toBe('pending_review');
    expect(texts(calls)).toContain(t('uz', 'verificationSubmitted'));
  });

  it.each(['uz', 'ru', 'en'] as const)(
    'shows rejected reason in %s and allows resubmit',
    async (language) => {
      const api = new FakeApi();
      api.data.user = user({ language, onboardingRole: 'lawyer', onboardingStatus: 'completed' });
      api.lawyer.verification = verification({
        rejectReason: 'Invalid document',
        status: 'rejected',
      });
      const { bot, calls } = fixture(api);
      await bot.handleUpdate(callbackUpdate('settings:lawyer-profile', 130), botInfo);
      expect(texts(calls).join('\n')).toContain(t(language, 'verificationRejected'));
      expect(texts(calls).join('\n')).toContain('Invalid document');
    },
  );

  it('switches an approved lawyer to the lawyer keyboard', async () => {
    const api = new FakeApi();
    api.data.user = user({
      language: 'en',
      onboardingRole: 'lawyer',
      onboardingStatus: 'completed',
    });
    api.lawyer.profile = lawyerProfile();
    api.lawyer.verification = verification({ status: 'approved' });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(callbackUpdate('lawyer:mode', 140), botInfo);
    expect(api.data.user.activeMode).toBe('lawyer');
    expect(JSON.stringify(calls)).toContain(t('en', 'marketplace'));
  });
});

describe('Yuristim AI Telegram UX', () => {
  function completedUser(language: 'uz' | 'ru' | 'en'): FakeApi {
    const api = new FakeApi();
    api.data.user = user({ language, onboardingRole: 'user', onboardingStatus: 'completed' });
    return api;
  }

  it.each(['uz', 'ru', 'en'] as const)('opens the localized AI entry in %s', async (language) => {
    const api = completedUser(language);
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(textUpdate(t(language, 'ai'), 200), botInfo);
    expect(api.aiStatus.botChatActive).toBe(true);
    expect(texts(calls).join('\n')).toContain(t(language, 'aiTitle'));
    expect(JSON.stringify(calls)).toContain(t(language, 'aiNewChat'));
    expect(JSON.stringify(calls)).toContain(t(language, 'aiHistory'));
  });

  it('pseudo-streams progress then edits it with the final answer and charge', async () => {
    const api = completedUser('uz');
    api.aiStatus = { ...api.aiStatus, botChatActive: true };
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(textUpdate('Mehnat shartnomasi nima?', 201), botInfo);
    expect(texts(calls)).toContain(t('uz', 'aiWorking'));
    expect(texts(calls).join('\n')).toContain('Sinov AI javobi');
    expect(texts(calls).join('\n')).toContain(`${t('uz', 'aiCreditsCharged')}: 1`);
    expect(api.aiMessages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('switches mode, opens history, creates an isolated chat, and leaves through Back', async () => {
    const api = completedUser('en');
    api.aiStatus = { ...api.aiStatus, botChatActive: true };
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(callbackUpdate('ai:mode:expert', 202), botInfo);
    expect(api.aiStatus.mode).toBe('expert');
    await bot.handleUpdate(callbackUpdate('ai:history', 203), botInfo);
    expect(texts(calls)).toContain(t('en', 'aiHistoryTitle'));
    await bot.handleUpdate(callbackUpdate('ai:new', 204), botInfo);
    expect(api.aiConversations).toHaveLength(2);
    expect(api.aiMessages).toHaveLength(0);
    await bot.handleUpdate(callbackUpdate('ai:back', 205), botInfo);
    expect(api.aiStatus.botChatActive).toBe(false);
    expect(texts(calls)).toContain(t('en', 'mainTitle'));
  });

  it('redirects Telegram documents to Mini App/Web without uploading for AI analysis', async () => {
    const api = completedUser('ru');
    api.aiStatus = { ...api.aiStatus, botChatActive: true };
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(documentUpdate(206, 'application/pdf', 'contract.pdf'), botInfo);
    expect(texts(calls)).toContain(t('ru', 'aiFileWebOnly'));
    expect(api.uploads).toHaveLength(0);
  });

  it('chunks long plain text without truncating content or exceeding Telegram safety limit', () => {
    const value = Array.from({ length: 1_500 }, (_, index) => `band-${index}`).join(' ');
    const chunks = telegramChunks(value);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 3_800)).toBe(true);
    expect(chunks.join(' ')).toBe(value);
  });
});
