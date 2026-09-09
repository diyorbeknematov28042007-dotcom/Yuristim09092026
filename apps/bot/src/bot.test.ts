import type { BotOnboardingAction, BotUserContext, UserView } from '@yuristim/types';
import type { Update, UserFromGetMe } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import type { EnsureUserResult, YuristimApi } from './api/yuristim-api.client.js';
import { createBot } from './bot.js';
import { t } from './i18n/index.js';
import { mainLawyerKeyboard } from './keyboards/main-lawyer.keyboard.js';

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
    termsVersion: '2026-09',
    token: 'test-token',
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

function texts(calls: TelegramCall[]): string[] {
  return calls
    .filter((call) => ['sendMessage', 'editMessageText'].includes(call.method))
    .map((call) => String(call.payload.text));
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
  it('renders navigation and clean feature shells', async () => {
    const api = new FakeApi();
    api.data.user = user({ language: 'en', onboardingRole: 'user', onboardingStatus: 'completed' });
    const { bot, calls } = fixture(api);
    await bot.handleUpdate(textUpdate(t('en', 'services'), 50), botInfo);
    await bot.handleUpdate(callbackUpdate('service:create-document', 51), botInfo);
    await bot.handleUpdate(textUpdate(t('en', 'settings'), 52), botInfo);
    await bot.handleUpdate(textUpdate(t('en', 'questions'), 53), botInfo);
    expect(texts(calls)).toEqual(
      expect.arrayContaining([
        t('en', 'servicesTitle'),
        t('en', 'documentLater'),
        t('en', 'settingsTitle'),
        t('en', 'questionsTitle'),
      ]),
    );
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
});
