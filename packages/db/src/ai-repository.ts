import type { Database } from './database.types.js';

export type AiConversationRow = Database['public']['Tables']['ai_conversations']['Row'];
export type AiMessageRow = Database['public']['Tables']['ai_messages']['Row'];
export type AiMessageSourceRow = Database['public']['Tables']['ai_message_sources']['Row'];
export type AiUserStateRow = Database['public']['Tables']['ai_user_states']['Row'];

export interface AiBeginMessageResult {
  duplicate: boolean;
  userMessage: AiMessageRow;
  assistantMessage: AiMessageRow;
}

export class AiConversationNotFoundError extends Error {
  constructor() {
    super('AI conversation not found');
    this.name = 'AiConversationNotFoundError';
  }
}

export class AiConversationBusyError extends Error {
  constructor() {
    super('AI conversation already has an active request');
    this.name = 'AiConversationBusyError';
  }
}

export interface AiRepository {
  createConversation(input: {
    userId: string;
    mode: 'fast' | 'expert';
    systemPromptVersion: string;
    now: Date;
  }): Promise<AiConversationRow>;
  listConversations(userId: string, limit: number): Promise<AiConversationRow[]>;
  findConversation(userId: string, publicId: string): Promise<AiConversationRow | null>;
  findConversationById(userId: string, id: string): Promise<AiConversationRow | null>;
  findMessage(publicId: string): Promise<AiMessageRow | null>;
  listMessages(conversationId: string): Promise<AiMessageRow[]>;
  listSources(messageIds: string[]): Promise<AiMessageSourceRow[]>;
  updateMode(input: {
    userId: string;
    conversationId: string;
    mode: 'fast' | 'expert';
    now: Date;
  }): Promise<AiConversationRow>;
  archiveConversation(userId: string, conversationId: string, now: Date): Promise<void>;
  beginMessage(input: {
    userId: string;
    conversationId: string;
    content: string;
    mode: 'fast' | 'expert';
    idempotencyKey: string;
    provider: string;
    model: string;
    systemPromptVersion: string;
    title: string;
    streaming: boolean;
    now: Date;
  }): Promise<AiBeginMessageResult>;
  completeMessage(input: {
    userId: string;
    messageId: string;
    content: string;
    inputTokens: number;
    outputTokens: number;
    providerCostUsd: number;
    chargedCredits: number;
    now: Date;
  }): Promise<AiMessageRow>;
  failMessage(input: {
    userId: string;
    messageId: string;
    errorCode: string;
    cancelled: boolean;
    now: Date;
  }): Promise<AiMessageRow>;
  reverseDeliveryCharge(userId: string, messageId: string, now: Date): Promise<AiMessageRow>;
  getUserState(userId: string): Promise<AiUserStateRow | null>;
  setBotState(input: {
    userId: string;
    activeConversationId: string | null;
    preferredMode: 'fast' | 'expert';
    active: boolean;
    now: Date;
  }): Promise<AiUserStateRow>;
}
