import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D1AiRepository, type D1AiBinding } from './d1-ai-repository.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
function binding(db: DatabaseSync): D1AiBinding {
  function prepare(sql: string) {
    let args: Array<string | number | null> = [];
    return {
      bind(...values: Array<string | number | null>) {
        args = values;
        return this;
      },
      async first<T>() {
        return (db.prepare(sql).get(...args) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...args) as T[] };
      },
      async run() {
        const result = db.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes) } };
      },
      query() {
        return { sql, args };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          const { sql, args } = (statement as ReturnType<typeof prepare>).query();
          if (/RETURNING\s+|^SELECT\s+/i.test(sql))
            results.push({ results: db.prepare(sql).all(...args) });
          else {
            db.prepare(sql).run(...args);
            results.push({ results: [] });
          }
        }
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

describe('D1 AI conversation repository against SQLite', () => {
  let db: DatabaseSync;
  let repo: D1AiRepository;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of [
      '0001_core_auth.sql',
      '0002_identifier_guards.sql',
      '0003_lawyer_admin.sql',
      '0004_finance.sql',
      '0005_payment_pending.sql',
      '0006_admin_bonus_audit.sql',
      '0007_marketplace.sql',
      '0008_ai.sql',
      '0009_documents.sql',
      '0010_founding100.sql',
      '0011_marketplace_lifecycle.sql',
      '0012_founding100_confirmation_events.sql',
      '0013_ai_credit_atomicity.sql',
      '0014_ai_message_immutable.sql',
    ])
      db.exec(readFileSync(new URL(`../../../cloudflare/d1/${name}`, import.meta.url), 'utf8'));
    db.prepare(
      "INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES('u',42,'yr_abcdefghijklmnop',?)",
    ).run(NOW.toISOString());
    db.prepare(
      "INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES('other',43,'yr_abcdefghijklmnox',?)",
    ).run(NOW.toISOString());
    repo = new D1AiRepository(binding(db));
  });
  afterEach(() => db.close());

  async function conversation(repository: D1AiRepository) {
    return repository.createConversation({
      userId: 'u',
      mode: 'fast',
      systemPromptVersion: 'v1',
      now: NOW,
    });
  }
  function request(conversationId: string) {
    return {
      userId: 'u',
      conversationId,
      content: 'A legal question',
      mode: 'fast' as const,
      idempotencyKey: 'prompt:one',
      provider: 'gemini',
      model: 'the-existing-model',
      systemPromptVersion: 'v1',
      title: 'Question',
      streaming: false,
      now: NOW,
    };
  }
  it('persists conversation, state, messages and idempotent completion with atomic debit/refund', async () => {
    const chat = await conversation(repo);
    expect((await repo.getUserState('u'))?.active_conversation_id).toBe(chat.id);
    const input = request(chat.id);
    const first = await repo.beginMessage(input);
    expect(first.duplicate).toBe(false);
    expect((await repo.beginMessage(input)).duplicate).toBe(true);
    expect(await repo.listMessages(chat.id)).toHaveLength(2);
    const answer = await repo.completeMessage({
      userId: 'u',
      messageId: first.assistantMessage.id,
      content: 'Answer',
      inputTokens: 10,
      outputTokens: 20,
      chargedCredits: 1,
      providerCostUsd: 0.000005,
      now: NOW,
    });
    expect(answer.charged_credits).toBe(1);
    expect((await repo.reverseDeliveryCharge('u', answer.id, NOW)).refunded_credits).toBe(1);
    expect((await repo.reverseDeliveryCharge('u', answer.id, NOW)).refunded_credits).toBe(1);
    const ledger = db
      .prepare(
        "SELECT type,sum(amount_milli) total FROM credit_transactions WHERE source IN ('ai_message','ai_delivery') GROUP BY type",
      )
      .all();
    expect(ledger).toEqual([
      { type: 'ai_usage', total: -1000 },
      { type: 'reversal', total: 1000 },
    ]);
    expect((await repo.listConversations('u', 10))[0]?.public_id).toBe(chat.public_id);
  });

  it('rejects cross-user writes and keeps only one active request', async () => {
    const chat = await conversation(repo);
    const input = request(chat.id);
    const first = await repo.beginMessage(input);
    await expect(repo.beginMessage({ ...input, userId: 'other' })).rejects.toThrow('not found');
    await expect(repo.beginMessage({ ...input, idempotencyKey: 'prompt:two' })).rejects.toThrow(
      'active request',
    );
    await expect(
      repo.completeMessage({
        userId: 'other',
        messageId: first.assistantMessage.id,
        content: 'Hijack',
        inputTokens: 1,
        outputTokens: 1,
        chargedCredits: 1,
        providerCostUsd: 0,
        now: NOW,
      }),
    ).rejects.toThrow('not found');
    await expect(
      repo.setBotState({
        userId: 'other',
        activeConversationId: chat.id,
        preferredMode: 'fast',
        active: true,
        now: NOW,
      }),
    ).rejects.toThrow();
    expect(await repo.listMessages(chat.id)).toHaveLength(2);
  });
  it('returns an insufficient credit error without settling or charging', async () => {
    const chat = await conversation(repo);
    const started = await repo.beginMessage(request(chat.id));
    await expect(
      repo.completeMessage({
        userId: 'u',
        messageId: started.assistantMessage.id,
        content: 'Answer',
        inputTokens: 1,
        outputTokens: 1,
        chargedCredits: 60000,
        providerCostUsd: 0,
        now: NOW,
      }),
    ).rejects.toThrow('Insufficient');
    expect((await repo.findMessage(started.assistantMessage.public_id))?.status).toBe('running');
    expect(
      db.prepare("SELECT count(*) total FROM credit_transactions WHERE type='ai_usage'").get(),
    ).toEqual({ total: 0 });
  });
});
