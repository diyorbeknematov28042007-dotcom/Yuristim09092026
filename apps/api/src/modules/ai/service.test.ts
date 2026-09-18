import {
  AiGateway,
  InMemoryAiProviderStateStore,
  AiProviderError,
  type AiModelConfig,
  type AiProviderAdapter,
  type AiProviderName,
} from '@yuristim/ai';
import type {
  AiBeginMessageResult,
  AiConversationRow,
  AiMessageRow,
  AiMessageSourceRow,
  AiProviderAttemptRow,
  AiRepository,
  AiUserStateRow,
} from '@yuristim/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors.js';
import type { CreditService } from '../credits/service.js';
import { AiService } from './service.js';

const now = new Date('2026-09-17T08:00:00.000Z');
const userA = '00000000-0000-4000-8000-000000000001';
const userB = '00000000-0000-4000-8000-000000000002';

function model(mode: 'fast' | 'expert', provider: AiProviderName): AiModelConfig {
  return {
    contextLimit: 8_000,
    enabled: true,
    estimateOutputTokens: 100,
    inputCostPerMillionUsd: 0.3,
    markupMultiplier: 1.5,
    maxOutputTokens: 512,
    mode,
    model: `${provider}-test`,
    outputCostPerMillionUsd: mode === 'fast' ? 2.5 : 10,
    provider,
    supportsStreaming: true,
    usdPerCredit: 0.002,
  };
}

class MemoryAiRepository implements AiRepository {
  conversations: AiConversationRow[] = [];
  messages: AiMessageRow[] = [];
  attempts: AiProviderAttemptRow[] = [];
  sources: AiMessageSourceRow[] = [];
  states = new Map<string, AiUserStateRow>();
  private sequence = 0;

  private id(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
  }

  private publicId(prefix: 'aic' | 'aim'): string {
    return `${prefix}_${String(this.sequence).padStart(24, '0')}`;
  }

  async createConversation(
    input: Parameters<AiRepository['createConversation']>[0],
  ): Promise<AiConversationRow> {
    const id = this.id();
    const row: AiConversationRow = {
      archived_at: null,
      created_at: input.now.toISOString(),
      id,
      last_message_at: null,
      mode: input.mode,
      public_id: this.publicId('aic'),
      status: 'active',
      system_prompt_version: input.systemPromptVersion,
      title: null,
      updated_at: input.now.toISOString(),
      user_id: input.userId,
    };
    this.conversations.push(row);
    await this.setBotState({
      active: true,
      activeConversationId: row.id,
      now: input.now,
      preferredMode: input.mode,
      userId: input.userId,
    });
    return row;
  }

  listConversations(userId: string, limit: number): Promise<AiConversationRow[]> {
    return Promise.resolve(
      this.conversations
        .filter((row) => row.user_id === userId && row.status === 'active')
        .slice(0, limit),
    );
  }

  findConversation(userId: string, publicId: string): Promise<AiConversationRow | null> {
    return Promise.resolve(
      this.conversations.find((row) => row.user_id === userId && row.public_id === publicId) ??
        null,
    );
  }

  findConversationById(userId: string, id: string): Promise<AiConversationRow | null> {
    return Promise.resolve(
      this.conversations.find((row) => row.user_id === userId && row.id === id) ?? null,
    );
  }

  findMessage(publicId: string): Promise<AiMessageRow | null> {
    return Promise.resolve(this.messages.find((row) => row.public_id === publicId) ?? null);
  }

  listMessages(conversationId: string): Promise<AiMessageRow[]> {
    return Promise.resolve(this.messages.filter((row) => row.conversation_id === conversationId));
  }

  listSources(messageIds: string[]): Promise<AiMessageSourceRow[]> {
    return Promise.resolve(this.sources.filter((row) => messageIds.includes(row.message_id)));
  }

  async updateMode(input: Parameters<AiRepository['updateMode']>[0]): Promise<AiConversationRow> {
    const row = this.conversations.find(
      (item) => item.id === input.conversationId && item.user_id === input.userId,
    );
    if (!row) throw new Error('missing');
    row.mode = input.mode;
    row.updated_at = input.now.toISOString();
    return row;
  }

  async archiveConversation(userId: string, conversationId: string, at: Date): Promise<void> {
    const row = this.conversations.find(
      (item) => item.id === conversationId && item.user_id === userId,
    );
    if (!row) throw new Error('missing');
    row.status = 'archived';
    row.archived_at = at.toISOString();
  }

  async beginMessage(
    input: Parameters<AiRepository['beginMessage']>[0],
  ): Promise<AiBeginMessageResult> {
    const duplicateUser = this.messages.find(
      (row) =>
        row.conversation_id === input.conversationId &&
        row.role === 'user' &&
        row.idempotency_key === input.idempotencyKey,
    );
    if (duplicateUser) {
      return {
        assistantMessage: this.messages.find((row) => row.request_message_id === duplicateUser.id)!,
        duplicate: true,
        userMessage: duplicateUser,
      };
    }
    const userId = this.id();
    const userMessage = this.message({
      completed_at: input.now.toISOString(),
      content: input.content.trim(),
      conversation_id: input.conversationId,
      id: userId,
      idempotency_key: input.idempotencyKey,
      mode: input.mode,
      public_id: this.publicId('aim'),
      role: 'user',
      status: 'completed',
      system_prompt_version: input.systemPromptVersion,
    });
    const assistantId = this.id();
    const assistantMessage = this.message({
      conversation_id: input.conversationId,
      id: assistantId,
      mode: input.mode,
      model: input.model,
      provider: input.provider,
      public_id: this.publicId('aim'),
      request_message_id: userId,
      role: 'assistant',
      status: input.streaming ? 'streaming' : 'running',
      system_prompt_version: input.systemPromptVersion,
    });
    this.messages.push(userMessage, assistantMessage);
    const conversation = this.conversations.find((row) => row.id === input.conversationId)!;
    conversation.mode = input.mode;
    conversation.title ??= input.title;
    conversation.last_message_at = input.now.toISOString();
    return { assistantMessage, duplicate: false, userMessage };
  }

  async completeMessage(
    input: Parameters<AiRepository['completeMessage']>[0],
  ): Promise<AiMessageRow> {
    const row = this.messages.find((item) => item.id === input.messageId)!;
    if (row.status === 'completed') return row;
    Object.assign(row, {
      charged_credits: input.chargedCredits,
      completed_at: input.now.toISOString(),
      content: input.content,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      provider_cost_usd: input.providerCostUsd,
      status: 'completed',
    });
    return row;
  }

  async routeMessage(input: Parameters<AiRepository['routeMessage']>[0]): Promise<AiMessageRow> {
    const row = this.messages.find((item) => item.id === input.messageId)!;
    row.provider = input.provider;
    row.model = input.model;
    return row;
  }

  recordProviderAttempt(
    input: Parameters<AiRepository['recordProviderAttempt']>[0],
  ): Promise<AiProviderAttemptRow> {
    const row: AiProviderAttemptRow = {
      attempt_number: input.attemptNumber,
      completed_at: input.completedAt.toISOString(),
      created_at: input.completedAt.toISOString(),
      error_category: input.errorCategory ?? null,
      id: this.id(),
      input_tokens: input.inputTokens ?? null,
      latency_ms: input.latencyMilliseconds,
      message_id: input.messageId,
      model: input.model,
      output_tokens: input.outputTokens ?? null,
      provider: input.provider,
      started_at: input.startedAt.toISOString(),
      status: input.status,
    };
    this.attempts.push(row);
    return Promise.resolve(row);
  }

  async failMessage(input: Parameters<AiRepository['failMessage']>[0]): Promise<AiMessageRow> {
    const row = this.messages.find((item) => item.id === input.messageId)!;
    Object.assign(row, {
      completed_at: input.now.toISOString(),
      error_code: input.errorCode,
      status: input.cancelled ? 'cancelled' : 'failed',
    });
    return row;
  }

  async reverseDeliveryCharge(_userId: string, messageId: string, at: Date): Promise<AiMessageRow> {
    const row = this.messages.find((item) => item.id === messageId)!;
    row.refunded_credits = row.charged_credits;
    row.status = 'failed';
    row.error_code = 'delivery_failed';
    row.completed_at = at.toISOString();
    return row;
  }

  getUserState(userId: string): Promise<AiUserStateRow | null> {
    return Promise.resolve(this.states.get(userId) ?? null);
  }

  setBotState(input: Parameters<AiRepository['setBotState']>[0]): Promise<AiUserStateRow> {
    const current = this.states.get(input.userId);
    const row: AiUserStateRow = {
      active_conversation_id: input.activeConversationId,
      bot_chat_active: input.active,
      preferred_mode: input.preferredMode,
      telegram_control_message_id: current?.telegram_control_message_id ?? null,
      updated_at: input.now.toISOString(),
      user_id: input.userId,
    };
    this.states.set(input.userId, row);
    return Promise.resolve(row);
  }

  replaceTelegramControlMessage(
    input: Parameters<AiRepository['replaceTelegramControlMessage']>[0],
  ): Promise<boolean> {
    const current = this.states.get(input.userId);
    if (!current || current.telegram_control_message_id !== input.expectedMessageId) {
      return Promise.resolve(false);
    }
    this.states.set(input.userId, {
      ...current,
      telegram_control_message_id: input.newMessageId,
      updated_at: input.now.toISOString(),
    });
    return Promise.resolve(true);
  }

  private message(
    overrides: Partial<AiMessageRow> & Pick<AiMessageRow, 'id' | 'public_id'>,
  ): AiMessageRow {
    return {
      charged_credits: 0,
      completed_at: null,
      content: '',
      conversation_id: '',
      created_at: now.toISOString(),
      error_code: null,
      idempotency_key: null,
      input_tokens: null,
      mode: 'fast',
      model: null,
      output_tokens: null,
      provider: null,
      provider_cost_usd: null,
      refunded_credits: 0,
      request_message_id: null,
      role: 'user',
      source_status: 'none',
      status: 'completed',
      system_prompt_version: 'uz-law-mvp-v1',
      ...overrides,
    };
  }
}

function fixture(options: { balance?: number; providerFailure?: AiProviderError } = {}) {
  const repository = new MemoryAiRepository();
  const generate = options.providerFailure
    ? vi.fn().mockRejectedValue(options.providerFailure)
    : vi.fn().mockResolvedValue({
        content: 'Normalized legal answer',
        usage: { inputTokens: 1_000, outputTokens: 1_000 },
      });
  const provider = (name: 'gemini' | 'openai'): AiProviderAdapter => ({
    configured: true,
    generate,
    name,
    stream: async (request, onDelta) => {
      const result = await generate(request);
      await onDelta(result.content);
      return result;
    },
    supportsStreaming: true,
  });
  const gateway = new AiGateway({
    adapters: [provider('gemini'), provider('openai')],
    circuitBreaker: {
      cooldownSeconds: 300,
      failureThreshold: 3,
      failureWindowSeconds: 120,
      halfOpenLeaseSeconds: 30,
      maxCooldownSeconds: 1_800,
    },
    expertRouting: { fixedProvider: 'openai', mode: 'fixed', order: ['openai'] },
    maxRetries: 0,
    models: [model('fast', 'gemini'), model('expert', 'openai')],
    providerStateStore: new InMemoryAiProviderStateStore(),
    timeoutMilliseconds: 100,
  });
  const balance = options.balance ?? 50;
  const credits = {
    getBalance: vi.fn().mockResolvedValue({
      bonus: balance,
      lowBalance: false,
      nextExpiry: null,
      paid: 0,
      total: balance,
      weekly: 0,
      zeroBalance: balance === 0,
    }),
  } as unknown as CreditService;
  return { generate, repository, service: new AiService(repository, gateway, credits, () => now) };
}

describe('AiService conversation and charging lifecycle', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates user-owned isolated conversations and rejects cross-user access', async () => {
    const { service } = fixture();
    const first = await service.createConversation(userA, 'uz');
    const second = await service.createConversation(userA, 'uz');
    expect(first.id).not.toBe(second.id);
    await expect(service.getConversation(userB, first.id, 'uz')).rejects.toMatchObject({
      code: 'AI_CONVERSATION_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('persists a successful answer, usage charge, and deterministic title', async () => {
    const { repository, service } = fixture();
    const conversation = await service.createConversation(userA, 'uz');
    const result = await service.send({
      content: 'Mehnat shartnomasi haqida tushuntiring',
      conversationId: conversation.id,
      idempotencyKey: 'request-success-1',
      language: 'uz',
      requestId: 'req-1',
      userId: userA,
    });
    expect(result.message).toMatchObject({ chargedCredits: 2.1, status: 'completed' });
    expect(result.conversation.title).toBe('Mehnat shartnomasi haqida tushuntiring');
    expect(repository.messages).toHaveLength(2);
  });

  it('returns a completed duplicate without a second provider call or charge', async () => {
    const { generate, repository, service } = fixture();
    const conversation = await service.createConversation(userA, 'uz');
    const input = {
      content: 'Takroriy savol',
      conversationId: conversation.id,
      idempotencyKey: 'request-duplicate-1',
      language: 'uz' as const,
      requestId: 'req-2',
      userId: userA,
    };
    await service.send(input);
    const duplicate = await service.send(input);
    expect(duplicate.duplicate).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
    expect(repository.messages.filter((row) => row.role === 'assistant')).toHaveLength(1);
  });

  it('marks provider failure with zero charge and returns a safe normalized error', async () => {
    const { repository, service } = fixture({
      providerFailure: new AiProviderError('unavailable', false, 'raw secret response'),
    });
    const conversation = await service.createConversation(userA, 'en');
    await expect(
      service.send({
        content: 'Help',
        conversationId: conversation.id,
        idempotencyKey: 'request-failure-1',
        language: 'en',
        requestId: 'req-3',
        userId: userA,
      }),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'AI provider is unavailable',
    });
    expect(repository.messages.find((row) => row.role === 'assistant')).toMatchObject({
      charged_credits: 0,
      error_code: 'provider_unavailable',
      status: 'failed',
    });
  });

  it('charges exactly once for the final successful provider after Expert failover', async () => {
    const repository = new MemoryAiRepository();
    const bai = vi.fn().mockRejectedValue(new AiProviderError('timeout', false));
    const openai = vi.fn().mockResolvedValue({
      content: 'OpenAI final answer',
      usage: { inputTokens: 1_000, outputTokens: 1_000 },
    });
    const gateway = new AiGateway({
      adapters: [
        {
          configured: true,
          generate: bai,
          name: 'bai',
          stream: vi.fn(),
          supportsStreaming: true,
        },
        {
          configured: true,
          generate: openai,
          name: 'openai',
          stream: vi.fn(),
          supportsStreaming: true,
        },
      ],
      circuitBreaker: {
        cooldownSeconds: 300,
        failureThreshold: 3,
        failureWindowSeconds: 120,
        halfOpenLeaseSeconds: 30,
        maxCooldownSeconds: 1_800,
      },
      expertRouting: { mode: 'auto', order: ['bai', 'openai', 'anthropic'] },
      maxRetries: 0,
      models: [
        model('fast', 'gemini'),
        model('expert', 'bai'),
        model('expert', 'openai'),
        model('expert', 'anthropic'),
      ],
      providerStateStore: new InMemoryAiProviderStateStore(),
      timeoutMilliseconds: 100,
    });
    const credits = {
      getBalance: vi.fn().mockResolvedValue({
        bonus: 50,
        lowBalance: false,
        nextExpiry: null,
        paid: 0,
        total: 50,
        weekly: 0,
        zeroBalance: false,
      }),
    } as unknown as CreditService;
    const complete = vi.spyOn(repository, 'completeMessage');
    const service = new AiService(repository, gateway, credits, () => now);
    const conversation = await service.createConversation(userA, 'uz', 'expert');
    const result = await service.send({
      content: 'Murakkab huquqiy savol',
      conversationId: conversation.id,
      idempotencyKey: 'request-expert-failover',
      language: 'uz',
      requestId: 'req-expert-failover',
      userId: userA,
    });
    expect(result.message.status).toBe('completed');
    expect(complete).toHaveBeenCalledOnce();
    expect(repository.attempts.map((attempt) => [attempt.provider, attempt.status])).toEqual([
      ['bai', 'failed'],
      ['openai', 'succeeded'],
    ]);
    expect(repository.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(repository.messages.find((message) => message.role === 'assistant')).toMatchObject({
      provider: 'openai',
      status: 'completed',
    });
  });

  it('charges zero and persists one failed assistant when all Expert providers fail', async () => {
    const repository = new MemoryAiRepository();
    const adapters = (['bai', 'openai', 'anthropic'] as const).map((name): AiProviderAdapter => ({
      configured: true,
      generate: vi.fn().mockRejectedValue(new AiProviderError('unavailable', false)),
      name,
      stream: vi.fn(),
      supportsStreaming: true,
    }));
    const gateway = new AiGateway({
      adapters,
      circuitBreaker: {
        cooldownSeconds: 300,
        failureThreshold: 3,
        failureWindowSeconds: 120,
        halfOpenLeaseSeconds: 30,
        maxCooldownSeconds: 1_800,
      },
      expertRouting: { mode: 'auto', order: ['bai', 'openai', 'anthropic'] },
      maxRetries: 0,
      models: [
        model('fast', 'gemini'),
        model('expert', 'bai'),
        model('expert', 'openai'),
        model('expert', 'anthropic'),
      ],
      providerStateStore: new InMemoryAiProviderStateStore(),
      timeoutMilliseconds: 100,
    });
    const credits = {
      getBalance: vi.fn().mockResolvedValue({
        bonus: 50,
        lowBalance: false,
        nextExpiry: null,
        paid: 0,
        total: 50,
        weekly: 0,
        zeroBalance: false,
      }),
    } as unknown as CreditService;
    const complete = vi.spyOn(repository, 'completeMessage');
    const service = new AiService(repository, gateway, credits, () => now);
    const conversation = await service.createConversation(userA, 'uz', 'expert');
    await expect(
      service.send({
        content: 'Barcha provider muvaffaqiyatsiz',
        conversationId: conversation.id,
        idempotencyKey: 'request-all-failed',
        language: 'uz',
        requestId: 'req-all-failed',
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(complete).not.toHaveBeenCalled();
    expect(repository.attempts).toHaveLength(3);
    expect(repository.messages.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({ charged_credits: 0, status: 'failed' }),
    ]);
  });

  it('persists an incomplete stream as failed with no charge', async () => {
    const repository = new MemoryAiRepository();
    const stream = vi.fn(async (_request, onDelta: (delta: string) => Promise<void>) => {
      await onDelta('partial');
      throw new AiProviderError('unavailable', true);
    });
    const adapter: AiProviderAdapter = {
      configured: true,
      generate: vi.fn(),
      name: 'gemini',
      stream,
      supportsStreaming: true,
    };
    const gateway = new AiGateway({
      adapters: [adapter],
      circuitBreaker: {
        cooldownSeconds: 300,
        failureThreshold: 3,
        failureWindowSeconds: 120,
        halfOpenLeaseSeconds: 30,
        maxCooldownSeconds: 1_800,
      },
      expertRouting: { fixedProvider: 'openai', mode: 'fixed', order: ['openai'] },
      maxRetries: 2,
      models: [model('fast', 'gemini'), model('expert', 'openai')],
      providerStateStore: new InMemoryAiProviderStateStore(),
      timeoutMilliseconds: 100,
      wait: () => Promise.resolve(),
    });
    const credits = {
      getBalance: vi.fn().mockResolvedValue({
        bonus: 50,
        lowBalance: false,
        nextExpiry: null,
        paid: 0,
        total: 50,
        weekly: 0,
        zeroBalance: false,
      }),
    } as unknown as CreditService;
    const service = new AiService(repository, gateway, credits, () => now);
    const conversation = await service.createConversation(userA, 'uz');
    await expect(
      service.send({
        content: 'Streaming savol',
        conversationId: conversation.id,
        idempotencyKey: 'request-stream-fail',
        language: 'uz',
        onDelta: vi.fn(),
        requestId: 'req-stream',
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(stream).toHaveBeenCalledOnce();
    expect(repository.messages.find((row) => row.role === 'assistant')).toMatchObject({
      charged_credits: 0,
      status: 'failed',
    });
  });

  it('blocks an insufficient balance before the provider is called', async () => {
    const { generate, repository, service } = fixture({ balance: 0 });
    const conversation = await service.createConversation(userA, 'ru');
    await expect(
      service.send({
        content: 'Вопрос',
        conversationId: conversation.id,
        idempotencyKey: 'request-no-credit',
        language: 'ru',
        requestId: 'req-4',
        userId: userA,
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(generate).not.toHaveBeenCalled();
    expect(repository.messages).toHaveLength(0);
  });

  it('preserves history while switching mode in the same conversation', async () => {
    const { generate, service } = fixture();
    const conversation = await service.createConversation(userA, 'uz');
    await service.send({
      content: 'Birinchi savol',
      conversationId: conversation.id,
      idempotencyKey: 'request-fast-0001',
      language: 'uz',
      requestId: 'req-5',
      userId: userA,
    });
    await service.switchMode(userA, conversation.id, 'uz', 'expert');
    await service.send({
      content: 'Oldingi savol bo‘yicha davom eting',
      conversationId: conversation.id,
      idempotencyKey: 'request-expert-01',
      language: 'uz',
      requestId: 'req-6',
      userId: userA,
    });
    const secondProviderRequest = generate.mock.calls[1]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(secondProviderRequest.messages.map((message) => message.content)).toEqual([
      'Birinchi savol',
      'Normalized legal answer',
      'Oldingi savol bo‘yicha davom eting',
    ]);
    const history = await service.getConversation(userA, conversation.id, 'uz');
    expect(
      history.messages
        .filter((message) => message.role === 'assistant')
        .map((message) => message.mode),
    ).toEqual(['fast', 'expert']);
  });

  it('reverses a completed charge when final delivery fails', async () => {
    const { service } = fixture();
    const conversation = await service.createConversation(userA, 'uz');
    const result = await service.send({
      content: 'Yetkazib berish testi',
      conversationId: conversation.id,
      idempotencyKey: 'request-delivery-1',
      language: 'uz',
      requestId: 'req-7',
      userId: userA,
    });
    await service.reverseDeliveryFailure(userA, result.message.id);
    const history = await service.getConversation(userA, conversation.id, 'uz');
    expect(history.messages.at(-1)).toMatchObject({
      chargedCredits: 0,
      content: '',
      status: 'failed',
    });
  });

  it('persists and atomically replaces the single Telegram AI controller', async () => {
    const { service } = fixture();
    await service.enterBot(userA, 'uz');
    expect((await service.botStatus(userA)).telegramControlMessageId).toBeNull();
    await expect(service.replaceBotController(userA, null, 101)).resolves.toBe(true);
    await expect(service.replaceBotController(userA, null, 202)).resolves.toBe(false);
    expect((await service.botStatus(userA)).telegramControlMessageId).toBe(101);
    await expect(service.replaceBotController(userA, 101, 202)).resolves.toBe(true);
    expect((await service.botStatus(userA)).telegramControlMessageId).toBe(202);
    await service.leaveBot(userA);
    expect((await service.botStatus(userA)).telegramControlMessageId).toBeNull();
  });
});
