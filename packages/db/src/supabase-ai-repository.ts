import type { Json } from './database.types.js';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import {
  AiConversationBusyError,
  AiConversationNotFoundError,
  type AiBeginMessageResult,
  type AiConversationRow,
  type AiMessageRow,
  type AiMessageSourceRow,
  type AiRepository,
  type AiUserStateRow,
} from './ai-repository.js';
import { InsufficientCreditsError } from './finance-repository.js';

function fail(error: PostgrestError): never {
  if (error.code === 'P0001') throw new InsufficientCreditsError();
  if (error.code === 'P0002') throw new AiConversationNotFoundError();
  if (error.code === 'P0004') throw new AiConversationBusyError();
  throw Object.assign(new Error(`Database operation failed (${error.code})`), {
    databaseCode: error.code,
  });
}

function required<T>(data: T | null, error: PostgrestError | null): T {
  if (error) fail(error);
  if (data === null) throw new Error('Database operation returned no data');
  return data;
}

function object(value: Json): Record<string, Json | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Database returned malformed AI data');
  }
  return value;
}

function beginResult(value: Json): AiBeginMessageResult {
  const result = object(value);
  if (typeof result.duplicate !== 'boolean' || !result.userMessage || !result.assistantMessage) {
    throw new Error('Database returned malformed AI message result');
  }
  return {
    assistantMessage: object(result.assistantMessage) as unknown as AiMessageRow,
    duplicate: result.duplicate,
    userMessage: object(result.userMessage) as unknown as AiMessageRow,
  };
}

export class SupabaseAiRepository implements AiRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async createConversation(
    input: Parameters<AiRepository['createConversation']>[0],
  ): Promise<AiConversationRow> {
    const { data, error } = await this.client.rpc('create_ai_conversation', {
      p_mode: input.mode,
      p_now: input.now.toISOString(),
      p_system_prompt_version: input.systemPromptVersion,
      p_user_id: input.userId,
    });
    return required(data, error);
  }

  async listConversations(userId: string, limit: number): Promise<AiConversationRow[]> {
    const { data, error } = await this.client
      .from('ai_conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return data;
  }

  async findConversation(userId: string, publicId: string): Promise<AiConversationRow | null> {
    const { data, error } = await this.client
      .from('ai_conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('public_id', publicId)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async findConversationById(userId: string, id: string): Promise<AiConversationRow | null> {
    const { data, error } = await this.client
      .from('ai_conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async findMessage(publicId: string): Promise<AiMessageRow | null> {
    const { data, error } = await this.client
      .from('ai_messages')
      .select('*')
      .eq('public_id', publicId)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async listMessages(conversationId: string): Promise<AiMessageRow[]> {
    const { data, error } = await this.client
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at')
      .order('id');
    if (error) fail(error);
    return data;
  }

  async listSources(messageIds: string[]): Promise<AiMessageSourceRow[]> {
    if (messageIds.length === 0) return [];
    const { data, error } = await this.client
      .from('ai_message_sources')
      .select('*')
      .in('message_id', messageIds)
      .order('citation_order');
    if (error) fail(error);
    return data;
  }

  async updateMode(input: Parameters<AiRepository['updateMode']>[0]): Promise<AiConversationRow> {
    const { data, error } = await this.client
      .from('ai_conversations')
      .update({ mode: input.mode, updated_at: input.now.toISOString() })
      .eq('id', input.conversationId)
      .eq('user_id', input.userId)
      .eq('status', 'active')
      .select('*')
      .maybeSingle();
    if (error) fail(error);
    if (!data) throw new AiConversationNotFoundError();
    return data;
  }

  async archiveConversation(userId: string, conversationId: string, now: Date): Promise<void> {
    const { data, error } = await this.client
      .from('ai_conversations')
      .update({ archived_at: now.toISOString(), status: 'archived', updated_at: now.toISOString() })
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();
    if (error) fail(error);
    if (!data) throw new AiConversationNotFoundError();
    const state = await this.getUserState(userId);
    if (state?.active_conversation_id === conversationId) {
      await this.setBotState({
        active: false,
        activeConversationId: null,
        now,
        preferredMode: state.preferred_mode as 'fast' | 'expert',
        userId,
      });
    }
  }

  async beginMessage(
    input: Parameters<AiRepository['beginMessage']>[0],
  ): Promise<AiBeginMessageResult> {
    const { data, error } = await this.client.rpc('begin_ai_message', {
      p_content: input.content,
      p_conversation_id: input.conversationId,
      p_idempotency_key: input.idempotencyKey,
      p_mode: input.mode,
      p_model: input.model,
      p_now: input.now.toISOString(),
      p_provider: input.provider,
      p_streaming: input.streaming,
      p_system_prompt_version: input.systemPromptVersion,
      p_title: input.title,
      p_user_id: input.userId,
    });
    return beginResult(required(data, error));
  }

  async completeMessage(
    input: Parameters<AiRepository['completeMessage']>[0],
  ): Promise<AiMessageRow> {
    const { data, error } = await this.client.rpc('complete_ai_message', {
      p_charged_credits: input.chargedCredits,
      p_content: input.content,
      p_input_tokens: input.inputTokens,
      p_message_id: input.messageId,
      p_now: input.now.toISOString(),
      p_output_tokens: input.outputTokens,
      p_provider_cost_usd: input.providerCostUsd,
      p_user_id: input.userId,
    });
    return required(data, error);
  }

  async failMessage(input: Parameters<AiRepository['failMessage']>[0]): Promise<AiMessageRow> {
    const { data, error } = await this.client.rpc('fail_ai_message', {
      p_cancelled: input.cancelled,
      p_error_code: input.errorCode,
      p_message_id: input.messageId,
      p_now: input.now.toISOString(),
      p_user_id: input.userId,
    });
    return required(data, error);
  }

  async reverseDeliveryCharge(userId: string, messageId: string, now: Date): Promise<AiMessageRow> {
    const { data, error } = await this.client.rpc('reverse_ai_delivery_charge', {
      p_message_id: messageId,
      p_now: now.toISOString(),
      p_user_id: userId,
    });
    return required(data, error);
  }

  async getUserState(userId: string): Promise<AiUserStateRow | null> {
    const { data, error } = await this.client
      .from('ai_user_states')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  async setBotState(input: Parameters<AiRepository['setBotState']>[0]): Promise<AiUserStateRow> {
    const { data, error } = await this.client
      .from('ai_user_states')
      .upsert({
        active_conversation_id: input.activeConversationId,
        bot_chat_active: input.active,
        preferred_mode: input.preferredMode,
        updated_at: input.now.toISOString(),
        user_id: input.userId,
      })
      .select('*')
      .single();
    return required(data, error);
  }
}
