type SqlValue = string | number | null;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
}
export interface D1TelegramUpdateBinding {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Array<{ results: unknown[] }>>;
}
interface ClaimRow {
  update_id: number;
  lease_id: string;
  status: 'processing' | 'failed' | 'completed';
  attempts: number;
}
export type TelegramUpdateClaim =
  { status: 'acquired'; leaseId: string } | { status: 'completed' | 'busy' };

export class D1TelegramUpdateRepository {
  constructor(private readonly db: D1TelegramUpdateBinding) {}

  async claim(updateId: number, chatId: number | null, now: Date): Promise<TelegramUpdateClaim> {
    if (
      !Number.isSafeInteger(updateId) ||
      updateId < 0 ||
      (chatId !== null && !Number.isSafeInteger(chatId))
    )
      throw new Error('Invalid Telegram update identifier');
    const leaseId = crypto.randomUUID();
    const time = now.toISOString();
    // The batch is a transaction: reclaim expired per-chat leases and acquire
    // the update in one serialized write. A stale worker cannot finish a new lease.
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `UPDATE telegram_update_claims SET status='failed',updated_at=?
            WHERE status='processing' AND lease_until<=? AND chat_id IS ?`,
          )
          .bind(time, time, chatId),
        this.db
          .prepare(
            `INSERT INTO telegram_update_claims
            (update_id,chat_id,lease_id,status,attempts,lease_until,created_at,updated_at)
            VALUES(?,?,?,'processing',1,?,?,?)
            ON CONFLICT(update_id) DO UPDATE SET lease_id=excluded.lease_id,
              status='processing',attempts=CASE WHEN telegram_update_claims.attempts=20
                THEN 1 ELSE telegram_update_claims.attempts+1 END,
              lease_until=excluded.lease_until,updated_at=excluded.updated_at
            WHERE telegram_update_claims.status='failed'
            RETURNING update_id,lease_id,status,attempts`,
          )
          .bind(
            updateId,
            chatId,
            leaseId,
            new Date(now.getTime() + 120_000).toISOString(),
            time,
            time,
          ),
      ]);
      if (results[1]?.results.length) return { status: 'acquired', leaseId };
    } catch (error) {
      if (!(error instanceof Error) || !/UNIQUE|constraint failed/i.test(error.message))
        throw error;
    }
    const existing = await this.db
      .prepare(
        'SELECT update_id,lease_id,status,attempts FROM telegram_update_claims WHERE update_id=?',
      )
      .bind(updateId)
      .first<ClaimRow>();
    return { status: existing?.status === 'completed' ? 'completed' : 'busy' };
  }

  async finish(updateId: number, leaseId: string, success: boolean, now: Date): Promise<boolean> {
    const row = await this.db
      .prepare(
        `UPDATE telegram_update_claims SET status=?,updated_at=? WHERE update_id=?
        AND lease_id=? AND status='processing' RETURNING update_id`,
      )
      .bind(success ? 'completed' : 'failed', now.toISOString(), updateId, leaseId)
      .first<{ update_id: number }>();
    return row !== null;
  }
}
