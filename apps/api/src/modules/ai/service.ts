import {
  AiProviderError,
  YURISTIM_SYSTEM_PROMPT_VERSION,
  buildConversationContext,
  buildYuristimSystemPrompt,
  calculateCreditCharge,
  calculateProviderCostUsd,
  deriveConversationTitle,
  estimateCreditCharge,
  estimateTokens,
  type AiGateway,
  type AiMode,
  type AiProviderErrorCategory,
} from '@yuristim/ai';
import {
  AiConversationBusyError,
  AiConversationNotFoundError,
  InsufficientCreditsError,
  type AiConversationRow,
  type AiMessageRow,
  type AiMessageSourceRow,
  type AiRepository,
} from '@yuristim/db';
import type {
  AiConversationView,
  AiEstimateView,
  AiMessageSourceView,
  AiMessageView,
  AiSendResult,
  AiStatusView,
  Language,
} from '@yuristim/types';
import { AppError } from '../../lib/errors.js';
import type { CreditService } from '../credits/service.js';

const defaultTitles: Record<Language, string> = {
  en: 'New chat',
  ru: 'Новый чат',
  uz: 'Yangi chat',
};

export interface AiTelemetry {
  requestId: string;
  conversationId: string;
  provider: string;
  model: string;
  durationMilliseconds: number;
  success: boolean;
  inputTokens?: number;
  outputTokens?: number;
  chargedCredits?: number;
  errorCategory?: string;
}

export interface AiSendInput {
  userId: string;
  conversationId: string;
  language: Language;
  content: string;
  idempotencyKey: string;
  mode?: AiMode | undefined;
  signal?: AbortSignal | undefined;
  onDelta?: ((delta: string) => void | Promise<void>) | undefined;
  requestId: string;
  telemetry?: ((event: AiTelemetry) => void) | undefined;
}

function conversationView(row: AiConversationRow, language: Language): AiConversationView {
  return {
    createdAt: row.created_at,
    id: row.public_id,
    lastMessageAt: row.last_message_at,
    mode: row.mode as AiMode,
    status: row.status as 'active' | 'archived',
    title: row.title ?? defaultTitles[language],
    updatedAt: row.updated_at,
  };
}

function sourceView(row: AiMessageSourceRow): AiMessageSourceView {
  return {
    citationOrder: row.citation_order,
    domain: row.domain,
    official: row.is_official,
    publisher: row.publisher,
    sourceType: row.source_type as AiMessageSourceView['sourceType'],
    title: row.title,
    url: row.url,
    verified: row.verified,
  };
}

function messageView(row: AiMessageRow, sources: AiMessageSourceRow[]): AiMessageView {
  const visibleContent = row.status === 'failed' || row.status === 'cancelled' ? '' : row.content;
  return {
    chargedCredits:
      row.status === 'completed' ? Number(row.charged_credits) - Number(row.refunded_credits) : 0,
    completedAt: row.completed_at,
    content: visibleContent,
    createdAt: row.created_at,
    id: row.public_id,
    mode: row.mode as AiMode,
    role: row.role as 'user' | 'assistant',
    sourceStatus: row.source_status as AiMessageView['sourceStatus'],
    sources: sources.filter((source) => source.message_id === row.id).map(sourceView),
    status: row.status as AiMessageView['status'],
  };
}

function providerAppError(category: AiProviderErrorCategory): AppError {
  switch (category) {
    case 'configuration':
      return new AppError(503, 'AI_PROVIDER_NOT_CONFIGURED', 'AI mode is not configured');
    case 'timeout':
      return new AppError(504, 'AI_PROVIDER_TIMEOUT', 'AI request timed out');
    case 'rate_limit':
      return new AppError(503, 'AI_PROVIDER_RATE_LIMIT', 'AI provider is temporarily busy');
    case 'cancelled':
      return new AppError(408, 'AI_REQUEST_CANCELLED', 'AI request was cancelled');
    case 'invalid_request':
    case 'unavailable':
    case 'unknown':
      return new AppError(503, 'AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable');
  }
}

function errorCode(error: AiProviderError): string {
  return `provider_${error.category}`;
}

export class AiService {
  constructor(
    readonly repository: AiRepository,
    readonly gateway: AiGateway,
    private readonly credits: CreditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  availability(): Record<AiMode, boolean> {
    return this.gateway.availability();
  }

  async createConversation(
    userId: string,
    language: Language,
    mode: AiMode = 'fast',
  ): Promise<AiConversationView> {
    return conversationView(
      await this.repository.createConversation({
        mode,
        now: this.now(),
        systemPromptVersion: YURISTIM_SYSTEM_PROMPT_VERSION,
        userId,
      }),
      language,
    );
  }

  async listConversations(
    userId: string,
    language: Language,
    limit = 20,
  ): Promise<AiConversationView[]> {
    return (await this.repository.listConversations(userId, limit)).map((row) =>
      conversationView(row, language),
    );
  }

  async getConversation(
    userId: string,
    publicId: string,
    language: Language,
  ): Promise<{ conversation: AiConversationView; messages: AiMessageView[] }> {
    const conversation = await this.ownedConversation(userId, publicId);
    const messages = await this.repository.listMessages(conversation.id);
    const sources = await this.repository.listSources(messages.map((message) => message.id));
    return {
      conversation: conversationView(conversation, language),
      messages: messages.map((message) => messageView(message, sources)),
    };
  }

  async switchMode(
    userId: string,
    publicId: string,
    language: Language,
    mode: AiMode,
  ): Promise<AiConversationView> {
    const conversation = await this.ownedConversation(userId, publicId);
    const now = this.now();
    const updated = await this.repository.updateMode({
      conversationId: conversation.id,
      mode,
      now,
      userId,
    });
    const state = await this.repository.getUserState(userId);
    await this.repository.setBotState({
      active: state?.bot_chat_active ?? false,
      activeConversationId: state?.active_conversation_id ?? conversation.id,
      now,
      preferredMode: mode,
      userId,
    });
    return conversationView(updated, language);
  }

  async archive(userId: string, publicId: string): Promise<void> {
    const conversation = await this.ownedConversation(userId, publicId);
    await this.repository.archiveConversation(userId, conversation.id, this.now());
  }

  async enterBot(
    userId: string,
    language: Language,
  ): Promise<{ conversation: AiConversationView; status: AiStatusView }> {
    const state = await this.repository.getUserState(userId);
    let conversation = state?.active_conversation_id
      ? await this.repository.findConversationById(userId, state.active_conversation_id)
      : null;
    if (!conversation || conversation.status !== 'active') {
      const created = await this.repository.createConversation({
        mode: (state?.preferred_mode as AiMode | undefined) ?? 'fast',
        now: this.now(),
        systemPromptVersion: YURISTIM_SYSTEM_PROMPT_VERSION,
        userId,
      });
      conversation = created;
    } else {
      await this.repository.setBotState({
        active: true,
        activeConversationId: conversation.id,
        now: this.now(),
        preferredMode: conversation.mode as AiMode,
        userId,
      });
    }
    return {
      conversation: conversationView(conversation, language),
      status: await this.status(userId),
    };
  }

  async resumeBot(
    userId: string,
    publicId: string,
    language: Language,
  ): Promise<AiConversationView> {
    const conversation = await this.ownedConversation(userId, publicId);
    if (conversation.status !== 'active') throw new AiConversationNotFoundError();
    await this.repository.setBotState({
      active: true,
      activeConversationId: conversation.id,
      now: this.now(),
      preferredMode: conversation.mode as AiMode,
      userId,
    });
    return conversationView(conversation, language);
  }

  async leaveBot(userId: string): Promise<void> {
    const state = await this.repository.getUserState(userId);
    await this.repository.setBotState({
      active: false,
      activeConversationId: state?.active_conversation_id ?? null,
      now: this.now(),
      preferredMode: (state?.preferred_mode as AiMode | undefined) ?? 'fast',
      userId,
    });
  }

  async status(userId: string): Promise<AiStatusView> {
    const state = await this.repository.getUserState(userId);
    const activeConversation = state?.active_conversation_id
      ? await this.repository.findConversationById(userId, state.active_conversation_id)
      : null;
    return {
      activeConversationId: activeConversation?.public_id ?? null,
      availability: this.gateway.availability(),
      balance: await this.credits.getBalance(userId),
      botChatActive: state?.bot_chat_active ?? false,
      mode:
        (activeConversation?.mode as AiMode | undefined) ??
        (state?.preferred_mode as AiMode | undefined) ??
        'fast',
    };
  }

  async estimate(
    userId: string,
    publicId: string,
    language: Language,
    content: string,
    requestedMode?: AiMode,
  ): Promise<AiEstimateView> {
    const conversation = await this.ownedConversation(userId, publicId);
    const mode = requestedMode ?? (conversation.mode as AiMode);
    const config = this.gateway.config(mode);
    const systemPrompt = buildYuristimSystemPrompt(language);
    const history = this.contextHistory(await this.repository.listMessages(conversation.id));
    const context = buildConversationContext(
      [...history, { content, createdAt: this.now().toISOString(), role: 'user' }],
      Math.max(1_024, config.contextLimit - config.maxOutputTokens - estimateTokens(systemPrompt)),
    );
    const estimate = estimateCreditCharge(config, context.messages, systemPrompt);
    const balance = await this.credits.getBalance(userId);
    return {
      currentBalance: balance.total,
      estimatedCredits: estimate.credits,
      estimatedInputTokens: estimate.estimatedInputTokens,
      estimatedOutputTokens: estimate.estimatedOutputTokens,
      mode,
      sufficientBalance: balance.total >= estimate.credits,
    };
  }

  async send(input: AiSendInput): Promise<AiSendResult> {
    const startedAt = Date.now();
    const conversation = await this.ownedConversation(input.userId, input.conversationId);
    const mode = input.mode ?? (conversation.mode as AiMode);
    const config = this.gateway.config(mode);
    const systemPrompt = buildYuristimSystemPrompt(input.language);
    const existingMessages = await this.repository.listMessages(conversation.id);
    const history = this.contextHistory(existingMessages);
    const contextWithPrompt = buildConversationContext(
      [...history, { content: input.content, createdAt: this.now().toISOString(), role: 'user' }],
      Math.max(1_024, config.contextLimit - config.maxOutputTokens - estimateTokens(systemPrompt)),
    );
    const estimate = estimateCreditCharge(config, contextWithPrompt.messages, systemPrompt);
    const balance = await this.credits.getBalance(input.userId);
    if (balance.total < estimate.credits) {
      throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits');
    }

    let assistantMessage: AiMessageRow | undefined;
    try {
      const begun = await this.repository.beginMessage({
        content: input.content,
        conversationId: conversation.id,
        idempotencyKey: input.idempotencyKey,
        mode,
        model: config.model,
        now: this.now(),
        provider: config.provider,
        streaming: Boolean(input.onDelta),
        systemPromptVersion: YURISTIM_SYSTEM_PROMPT_VERSION,
        title: deriveConversationTitle(input.content),
        userId: input.userId,
      });
      assistantMessage = begun.assistantMessage;
      if (begun.duplicate) {
        if (assistantMessage.status === 'completed') {
          const updatedConversation = await this.ownedConversation(
            input.userId,
            input.conversationId,
          );
          return {
            conversation: conversationView(updatedConversation, input.language),
            duplicate: true,
            message: messageView(assistantMessage, []),
          };
        }
        throw new AppError(409, 'AI_CONVERSATION_BUSY', 'AI request is already processing');
      }

      const messages = await this.repository.listMessages(conversation.id);
      const context = buildConversationContext(
        this.contextHistory(messages, assistantMessage.id),
        Math.max(
          1_024,
          config.contextLimit - config.maxOutputTokens - estimateTokens(systemPrompt),
        ),
      );
      const generated = await this.gateway.execute({
        messages: context.messages,
        mode,
        ...(input.onDelta ? { onDelta: input.onDelta } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
        systemPrompt,
      });
      const providerCostUsd = calculateProviderCostUsd(config, generated.usage);
      const chargedCredits = calculateCreditCharge(config, generated.usage);
      const completed = await this.repository.completeMessage({
        chargedCredits,
        content: generated.content,
        inputTokens: generated.usage.inputTokens,
        messageId: assistantMessage.id,
        now: this.now(),
        outputTokens: generated.usage.outputTokens,
        providerCostUsd,
        userId: input.userId,
      });
      input.telemetry?.({
        chargedCredits,
        conversationId: conversation.id,
        durationMilliseconds: Date.now() - startedAt,
        inputTokens: generated.usage.inputTokens,
        model: config.model,
        outputTokens: generated.usage.outputTokens,
        provider: config.provider,
        requestId: input.requestId,
        success: true,
      });
      const updatedConversation = await this.ownedConversation(input.userId, input.conversationId);
      return {
        conversation: conversationView(updatedConversation, input.language),
        duplicate: false,
        message: messageView(completed, []),
      };
    } catch (error) {
      const category = error instanceof AiProviderError ? error.category : 'unknown';
      if (
        assistantMessage &&
        !['completed', 'failed', 'cancelled'].includes(assistantMessage.status)
      ) {
        await this.repository
          .failMessage({
            cancelled: error instanceof AiProviderError && error.category === 'cancelled',
            errorCode:
              error instanceof InsufficientCreditsError
                ? 'insufficient_credits'
                : error instanceof AiProviderError
                  ? errorCode(error)
                  : 'internal_error',
            messageId: assistantMessage.id,
            now: this.now(),
            userId: input.userId,
          })
          .catch(() => undefined);
      }
      input.telemetry?.({
        conversationId: conversation.id,
        durationMilliseconds: Date.now() - startedAt,
        errorCategory: category,
        model: config.model,
        provider: config.provider,
        requestId: input.requestId,
        success: false,
      });
      if (error instanceof AppError) throw error;
      if (error instanceof InsufficientCreditsError)
        throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits');
      if (error instanceof AiProviderError) throw providerAppError(error.category);
      if (error instanceof AiConversationBusyError)
        throw new AppError(409, 'AI_CONVERSATION_BUSY', error.message);
      if (error instanceof AiConversationNotFoundError)
        throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', error.message);
      throw error;
    }
  }

  async reverseDeliveryFailure(userId: string, publicMessageId: string): Promise<void> {
    const message = await this.repository.findMessage(publicMessageId);
    if (
      !message ||
      message.role !== 'assistant' ||
      !(await this.repository.findConversationById(userId, message.conversation_id))
    ) {
      throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', 'AI message not found');
    }
    await this.repository.reverseDeliveryCharge(userId, message.id, this.now());
  }

  private async ownedConversation(userId: string, publicId: string): Promise<AiConversationRow> {
    const conversation = await this.repository.findConversation(userId, publicId);
    if (!conversation) {
      throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', 'AI conversation not found');
    }
    return conversation;
  }

  private contextHistory(messages: AiMessageRow[], activeAssistantId?: string) {
    const assistantByRequest = new Map(
      messages
        .filter((message) => message.role === 'assistant' && message.request_message_id)
        .map((message) => [message.request_message_id!, message]),
    );
    return messages
      .filter((message) => {
        if (message.role === 'assistant') return message.status === 'completed';
        const assistant = assistantByRequest.get(message.id);
        return assistant?.status === 'completed' || assistant?.id === activeAssistantId;
      })
      .map((message) => ({
        content: message.content,
        createdAt: message.created_at,
        role: message.role as 'user' | 'assistant',
      }));
  }
}
