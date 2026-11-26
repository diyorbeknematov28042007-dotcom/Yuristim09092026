import {
  AiConversationBusyError,
  AiConversationNotFoundError,
  type AiBeginMessageResult,
  type AiConversationRow,
  type AiMessageRow,
  type AiMessageSourceRow,
  type AiProviderAttemptRow,
  type AiRepository,
  type AiUserStateRow,
} from './ai-repository.js';
import { InsufficientCreditsError } from './finance-repository.js';
import { D1AiProviderRepository, type D1AiProviderBinding } from './d1-ai-provider-repository.js';

type SqlValue = string | number | null;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface D1AiBinding extends D1AiProviderBinding {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Array<{ results: unknown[] }>>;
}
type MessageDbRow = Omit<
  AiMessageRow,
  'charged_credits' | 'refunded_credits' | 'provider_cost_usd'
> & {
  charged_milli: number;
  refunded_milli: number;
  provider_cost_usd_e8: number | null;
};
type SourceDbRow = Omit<AiMessageSourceRow, 'metadata' | 'is_official' | 'verified'> & {
  metadata: string;
  is_official: number;
  verified: number;
};
type StateDbRow = Omit<AiUserStateRow, 'bot_chat_active'> & { bot_chat_active: number };

function publicId(prefix: 'aic_' | 'aim_'): string {
  return prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 24);
}
function required<T>(row: T | null): T {
  if (!row) throw new Error('AI database row missing');
  return row;
}
function invalid(): never {
  throw Object.assign(new Error('Invalid AI operation'), { databaseCode: '22023' });
}
function message(row: MessageDbRow): AiMessageRow {
  const { charged_milli, refunded_milli, provider_cost_usd_e8, ...rest } = row;
  return {
    ...rest,
    charged_credits: charged_milli / 1000,
    refunded_credits: refunded_milli / 1000,
    provider_cost_usd: provider_cost_usd_e8 === null ? null : provider_cost_usd_e8 / 100000000,
  };
}
function source(row: SourceDbRow): AiMessageSourceRow {
  return {
    ...row,
    metadata: JSON.parse(row.metadata) as AiMessageSourceRow['metadata'],
    is_official: row.is_official === 1,
    verified: row.verified === 1,
  };
}
function state(row: StateDbRow): AiUserStateRow {
  return { ...row, bot_chat_active: row.bot_chat_active === 1 };
}
function milli(credits: number): number {
  if (!Number.isFinite(credits)) invalid();
  const match = String(credits).match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (!match) invalid();
  const amount = BigInt(match[1]!) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'));
  if (amount < 1000n || amount > 99999999999999n) invalid();
  return Number(amount);
}
function usdE8(cost: number): number {
  if (!Number.isFinite(cost) || cost < 0 || cost > 1000000) invalid();
  return Math.round(cost * 100000000);
}
function failure(error: unknown): never {
  if (error instanceof Error && /insufficient credits/i.test(error.message))
    throw new InsufficientCreditsError();
  throw error;
}

/** D1.batch is transactional; the active assistant unique index serializes concurrent begin requests. */
export class D1AiRepository extends D1AiProviderRepository implements AiRepository {
  constructor(private readonly aiDb: D1AiBinding) {
    super(aiDb);
  }

  async createConversation(
    input: Parameters<AiRepository['createConversation']>[0],
  ): Promise<AiConversationRow> {
    if (
      !['fast', 'expert'].includes(input.mode) ||
      !input.systemPromptVersion ||
      input.systemPromptVersion.length > 40
    )
      invalid();
    const id = crypto.randomUUID();
    const now = input.now.toISOString();
    const results = await this.aiDb.batch([
      this.aiDb
        .prepare(
          `INSERT INTO ai_conversations
          (id,public_id,user_id,mode,system_prompt_version,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?) RETURNING *`,
        )
        .bind(id, publicId('aic_'), input.userId, input.mode, input.systemPromptVersion, now, now),
      this.aiDb
        .prepare(
          `INSERT INTO ai_user_states
          (user_id,active_conversation_id,preferred_mode,bot_chat_active,updated_at)
          VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
          active_conversation_id=excluded.active_conversation_id,
          preferred_mode=excluded.preferred_mode,bot_chat_active=1,updated_at=excluded.updated_at`,
        )
        .bind(input.userId, id, input.mode, 1, now),
    ]);
    return required((results[0]?.results[0] as AiConversationRow | undefined) ?? null);
  }
  async listConversations(userId: string, limit: number): Promise<AiConversationRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid();
    return (
      await this.aiDb
        .prepare(
          `SELECT * FROM ai_conversations WHERE user_id=? AND status='active'
          ORDER BY last_message_at DESC,created_at DESC LIMIT ?`,
        )
        .bind(userId, limit)
        .all<AiConversationRow>()
    ).results;
  }
  async findConversation(userId: string, publicId: string): Promise<AiConversationRow | null> {
    return this.aiDb
      .prepare('SELECT * FROM ai_conversations WHERE user_id=? AND public_id=?')
      .bind(userId, publicId)
      .first<AiConversationRow>();
  }
  async findConversationById(userId: string, id: string): Promise<AiConversationRow | null> {
    return this.aiDb
      .prepare('SELECT * FROM ai_conversations WHERE user_id=? AND id=?')
      .bind(userId, id)
      .first<AiConversationRow>();
  }
  async findMessage(publicId: string): Promise<AiMessageRow | null> {
    const row = await this.aiDb
      .prepare('SELECT * FROM ai_messages WHERE public_id=?')
      .bind(publicId)
      .first<MessageDbRow>();
    return row && message(row);
  }
  async listMessages(conversationId: string): Promise<AiMessageRow[]> {
    const rows = (
      await this.aiDb
        .prepare('SELECT * FROM ai_messages WHERE conversation_id=? ORDER BY created_at,id')
        .bind(conversationId)
        .all<MessageDbRow>()
    ).results;
    return rows.map(message);
  }
  async listSources(messageIds: string[]): Promise<AiMessageSourceRow[]> {
    if (messageIds.length === 0) return [];
    if (messageIds.length > 100) invalid();
    const rows = (
      await this.aiDb
        .prepare(
          `SELECT * FROM ai_message_sources WHERE message_id IN (${messageIds.map(() => '?').join(',')})
          ORDER BY citation_order`,
        )
        .bind(...messageIds)
        .all<SourceDbRow>()
    ).results;
    return rows.map(source);
  }
  async updateMode(input: Parameters<AiRepository['updateMode']>[0]): Promise<AiConversationRow> {
    const row = await this.aiDb
      .prepare(
        `UPDATE ai_conversations SET mode=?,updated_at=?
        WHERE id=? AND user_id=? AND status='active' RETURNING *`,
      )
      .bind(input.mode, input.now.toISOString(), input.conversationId, input.userId)
      .first<AiConversationRow>();
    if (!row) throw new AiConversationNotFoundError();
    return row;
  }
  async archiveConversation(userId: string, conversationId: string, now: Date): Promise<void> {
    const time = now.toISOString();
    const results = await this.aiDb.batch([
      this.aiDb
        .prepare(
          `UPDATE ai_conversations SET status='archived',archived_at=?,updated_at=?
          WHERE id=? AND user_id=? AND status='active' RETURNING id`,
        )
        .bind(time, time, conversationId, userId),
      this.aiDb
        .prepare(
          `UPDATE ai_user_states SET active_conversation_id=NULL,
          bot_chat_active=0,updated_at=? WHERE user_id=? AND active_conversation_id=?
          AND EXISTS(SELECT 1 FROM ai_conversations WHERE id=? AND user_id=? AND status='archived')`,
        )
        .bind(time, userId, conversationId, conversationId, userId),
    ]);
    if (!results[0]?.results.length) throw new AiConversationNotFoundError();
  }

  async beginMessage(
    input: Parameters<AiRepository['beginMessage']>[0],
  ): Promise<AiBeginMessageResult> {
    if (
      !input.content.trim() ||
      input.content.trim().length > 12000 ||
      input.idempotencyKey.length < 8 ||
      input.idempotencyKey.length > 160 ||
      !['fast', 'expert'].includes(input.mode)
    )
      invalid();
    const conversation = await this.findConversationById(input.userId, input.conversationId);
    if (!conversation) throw new AiConversationNotFoundError();
    const prior = await this.findRequest(input.userId, input.conversationId, input.idempotencyKey);
    if (prior) return { ...prior, duplicate: true };
    const requestId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const now = input.now.toISOString();
    try {
      const results = await this.aiDb.batch([
        this.aiDb
          .prepare(
            `INSERT INTO ai_messages
            (id,public_id,conversation_id,role,content,mode,status,
             system_prompt_version,idempotency_key,created_at,completed_at)
            SELECT ?,?,?, 'user',?,?,'completed',?,?,?,?
            WHERE EXISTS(SELECT 1 FROM ai_conversations
              WHERE id=? AND user_id=? AND status='active')
            AND NOT EXISTS(SELECT 1 FROM ai_messages WHERE conversation_id=?
              AND role='assistant' AND status IN ('pending','running','streaming'))
            RETURNING *`,
          )
          .bind(
            requestId,
            publicId('aim_'),
            input.conversationId,
            input.content.trim(),
            input.mode,
            input.systemPromptVersion,
            input.idempotencyKey,
            now,
            now,
            input.conversationId,
            input.userId,
            input.conversationId,
          ),
        this.aiDb
          .prepare(
            `INSERT INTO ai_messages
            (id,public_id,conversation_id,request_message_id,role,mode,
             provider,model,status,system_prompt_version,created_at)
            VALUES(?,?,?,?,'assistant',?,?,?,?,?,?) RETURNING *`,
          )
          .bind(
            assistantId,
            publicId('aim_'),
            input.conversationId,
            requestId,
            input.mode,
            input.provider,
            input.model,
            input.streaming ? 'streaming' : 'running',
            input.systemPromptVersion,
            now,
          ),
        this.aiDb
          .prepare(
            `UPDATE ai_conversations SET mode=?,title=coalesce(title,nullif(trim(?),'')),
            last_message_at=?,updated_at=? WHERE id=? AND user_id=?`,
          )
          .bind(input.mode, input.title, now, now, input.conversationId, input.userId),
        this.aiDb
          .prepare(
            `INSERT INTO ai_user_states
            (user_id,active_conversation_id,preferred_mode,bot_chat_active,updated_at)
            VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
            active_conversation_id=excluded.active_conversation_id,
            preferred_mode=excluded.preferred_mode,bot_chat_active=1,updated_at=excluded.updated_at`,
          )
          .bind(input.userId, input.conversationId, input.mode, 1, now),
      ]);
      return {
        duplicate: false,
        userMessage: message(
          required((results[0]?.results[0] as MessageDbRow | undefined) ?? null),
        ),
        assistantMessage: message(
          required((results[1]?.results[0] as MessageDbRow | undefined) ?? null),
        ),
      };
    } catch (error) {
      const raced = await this.findRequest(
        input.userId,
        input.conversationId,
        input.idempotencyKey,
      );
      if (raced) return { ...raced, duplicate: true };
      if (conversation.status !== 'active') invalid();
      const busy = await this.aiDb
        .prepare(
          `SELECT id FROM ai_messages WHERE conversation_id=? AND role='assistant'
          AND status IN ('pending','running','streaming')`,
        )
        .bind(input.conversationId)
        .first<{ id: string }>();
      if (busy) throw new AiConversationBusyError();
      throw error;
    }
  }
  private async findRequest(
    userId: string,
    conversationId: string,
    key: string,
  ): Promise<Omit<AiBeginMessageResult, 'duplicate'> | null> {
    const user = await this.aiDb
      .prepare(
        `SELECT m.* FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id
        WHERE c.user_id=? AND m.conversation_id=? AND m.role='user' AND m.idempotency_key=?`,
      )
      .bind(userId, conversationId, key)
      .first<MessageDbRow>();
    if (!user) return null;
    const assistant = await this.aiDb
      .prepare('SELECT * FROM ai_messages WHERE request_message_id=?')
      .bind(user.id)
      .first<MessageDbRow>();
    return { userMessage: message(user), assistantMessage: message(required(assistant)) };
  }
  private async assistant(userId: string, messageId: string): Promise<MessageDbRow> {
    const row = await this.aiDb
      .prepare(
        `SELECT m.* FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id
        WHERE m.id=? AND m.role='assistant' AND c.user_id=?`,
      )
      .bind(messageId, userId)
      .first<MessageDbRow>();
    if (!row) throw new AiConversationNotFoundError();
    return row;
  }
  async routeMessage(input: Parameters<AiRepository['routeMessage']>[0]): Promise<AiMessageRow> {
    const row = await this.aiDb
      .prepare(
        `UPDATE ai_messages SET provider=?,model=?
        WHERE id=? AND role='assistant' AND status IN ('pending','running','streaming')
          AND EXISTS(SELECT 1 FROM ai_conversations WHERE id=ai_messages.conversation_id AND user_id=?)
        RETURNING *`,
      )
      .bind(input.provider, input.model, input.messageId, input.userId)
      .first<MessageDbRow>();
    if (!row) throw new AiConversationNotFoundError();
    return message(row);
  }
  async recordProviderAttempt(
    input: Parameters<AiRepository['recordProviderAttempt']>[0],
  ): Promise<AiProviderAttemptRow> {
    return required(
      await this.aiDb
        .prepare(
          `INSERT INTO ai_provider_attempts
          (id,message_id,attempt_number,provider,model,status,error_category,latency_ms,
            input_tokens,output_tokens,started_at,completed_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
        )
        .bind(
          crypto.randomUUID(),
          input.messageId,
          input.attemptNumber,
          input.provider,
          input.model,
          input.status,
          input.errorCategory ?? null,
          input.latencyMilliseconds,
          input.inputTokens ?? null,
          input.outputTokens ?? null,
          input.startedAt.toISOString(),
          input.completedAt.toISOString(),
        )
        .first<AiProviderAttemptRow>(),
    );
  }
  async completeMessage(
    input: Parameters<AiRepository['completeMessage']>[0],
  ): Promise<AiMessageRow> {
    const credits = milli(input.chargedCredits);
    const now = input.now.toISOString();
    try {
      const row = await this.aiDb
        .prepare(
          `UPDATE ai_messages SET content=trim(?),status='completed',input_tokens=?,
          output_tokens=?,provider_cost_usd_e8=?,charged_milli=?,completed_at=?
          WHERE id=? AND role='assistant' AND status IN ('pending','running','streaming')
            AND EXISTS(SELECT 1 FROM ai_conversations WHERE id=ai_messages.conversation_id AND user_id=?)
          RETURNING *`,
        )
        .bind(
          input.content,
          input.inputTokens,
          input.outputTokens,
          usdE8(input.providerCostUsd),
          credits,
          now,
          input.messageId,
          input.userId,
        )
        .first<MessageDbRow>();
      if (row) return message(row);
    } catch (error) {
      failure(error);
    }
    const previous = await this.assistant(input.userId, input.messageId);
    if (previous.status === 'completed') return message(previous);
    invalid();
  }
  async failMessage(input: Parameters<AiRepository['failMessage']>[0]): Promise<AiMessageRow> {
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(input.errorCode)) invalid();
    const row = await this.aiDb
      .prepare(
        `UPDATE ai_messages SET status=?,error_code=?,completed_at=?
        WHERE id=? AND role='assistant' AND status IN ('pending','running','streaming')
          AND EXISTS(SELECT 1 FROM ai_conversations WHERE id=ai_messages.conversation_id AND user_id=?)
        RETURNING *`,
      )
      .bind(
        input.cancelled ? 'cancelled' : 'failed',
        input.errorCode,
        input.now.toISOString(),
        input.messageId,
        input.userId,
      )
      .first<MessageDbRow>();
    if (row) return message(row);
    const previous = await this.assistant(input.userId, input.messageId);
    if (['failed', 'cancelled'].includes(previous.status)) return message(previous);
    invalid();
  }
  async reverseDeliveryCharge(userId: string, messageId: string, now: Date): Promise<AiMessageRow> {
    const row = await this.aiDb
      .prepare(
        `UPDATE ai_messages SET status='failed',error_code='delivery_failed',
        refunded_milli=charged_milli,completed_at=?
        WHERE id=? AND role='assistant' AND status='completed' AND charged_milli>=1000
          AND EXISTS(SELECT 1 FROM ai_conversations WHERE id=ai_messages.conversation_id AND user_id=?)
        RETURNING *`,
      )
      .bind(now.toISOString(), messageId, userId)
      .first<MessageDbRow>();
    if (row) return message(row);
    const previous = await this.assistant(userId, messageId);
    if (previous.status === 'failed' && previous.error_code === 'delivery_failed')
      return message(previous);
    invalid();
  }
  async getUserState(userId: string): Promise<AiUserStateRow | null> {
    const row = await this.aiDb
      .prepare('SELECT * FROM ai_user_states WHERE user_id=?')
      .bind(userId)
      .first<StateDbRow>();
    return row && state(row);
  }
  async setBotState(input: Parameters<AiRepository['setBotState']>[0]): Promise<AiUserStateRow> {
    const row = await this.aiDb
      .prepare(
        `INSERT INTO ai_user_states
        (user_id,active_conversation_id,preferred_mode,bot_chat_active,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
        active_conversation_id=excluded.active_conversation_id,
        preferred_mode=excluded.preferred_mode,bot_chat_active=excluded.bot_chat_active,
        updated_at=excluded.updated_at RETURNING *`,
      )
      .bind(
        input.userId,
        input.activeConversationId,
        input.preferredMode,
        input.active ? 1 : 0,
        input.now.toISOString(),
      )
      .first<StateDbRow>();
    return state(required(row));
  }
  async replaceTelegramControlMessage(
    input: Parameters<AiRepository['replaceTelegramControlMessage']>[0],
  ): Promise<boolean> {
    const row = await this.aiDb
      .prepare(
        `UPDATE ai_user_states SET telegram_control_message_id=?,updated_at=?
        WHERE user_id=? AND telegram_control_message_id IS ? RETURNING user_id`,
      )
      .bind(input.newMessageId, input.now.toISOString(), input.userId, input.expectedMessageId)
      .first<{ user_id: string }>();
    return row !== null;
  }
}
