import type {
  Founding100Analytics,
  Founding100AnalyticsDay,
  Founding100AnalyticsSource,
  Founding100ConfirmResult,
  Founding100Repository,
  Founding100ReservationRow,
  Founding100Status,
} from './founding100-repository.js';

type SqlValue = string | number | null;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface D1Founding100Binding {
  prepare(sql: string): Statement;
}
function fail(code: string): never {
  throw Object.assign(new Error(`Founding 100 operation failed (${code})`), {
    databaseCode: code,
    databaseMessage: code,
  });
}
function required<T>(row: T | null): T {
  if (!row) throw new Error('Founding 100 row missing');
  return row;
}
type Reservation = {
  id: string;
  expires_at: string;
  status: string;
  source: string;
  user_id: string | null;
};

export class D1Founding100Repository implements Founding100Repository {
  constructor(private readonly db: D1Founding100Binding) {}

  async getStatus(now: Date): Promise<Founding100Status> {
    const row = required(
      await this.db
        .prepare(
          `SELECT
      count(*) FILTER (WHERE status='confirmed') confirmed,
      count(*) FILTER (WHERE status='reserved' AND expires_at>?) reserved
      FROM founding100_reservations`,
        )
        .bind(now.toISOString())
        .first<{ confirmed: number; reserved: number }>(),
    );
    const available = Math.max(100 - row.confirmed - row.reserved, 0);
    return {
      limit: 100,
      confirmed: row.confirmed,
      reserved: row.reserved,
      available,
      isOpen: available > 0,
    };
  }
  async reserve(
    input: Parameters<Founding100Repository['reserve']>[0],
  ): Promise<Founding100ReservationRow> {
    if (
      !/^[a-f0-9]{64}$/.test(input.tokenHash) ||
      input.idempotencyKey.length < 8 ||
      input.idempotencyKey.length > 128 ||
      !/^[a-z0-9_-]{1,64}$/.test(input.source)
    )
      fail('22023');
    const now = input.now.toISOString();
    const existing = await this.db
      .prepare('SELECT * FROM founding100_reservations WHERE idempotency_key=?')
      .bind(input.idempotencyKey)
      .first<Reservation>();
    if (existing) {
      if (existing.status === 'reserved' && existing.expires_at > now)
        return this.reservation(existing, true);
      fail('P0004');
    }
    const expires = new Date(input.now.getTime() + 10 * 60000).toISOString();
    try {
      const row = required(
        await this.db
          .prepare(
            `INSERT INTO founding100_reservations
        (id,token_hash,idempotency_key,source,created_at,expires_at)
        VALUES(?,?,?,?,?,?) RETURNING *`,
          )
          .bind(
            crypto.randomUUID(),
            input.tokenHash,
            input.idempotencyKey,
            input.source,
            now,
            expires,
          )
          .first<Reservation>(),
      );
      return this.reservation(row, false);
    } catch (error) {
      if (error instanceof Error && /capacity/i.test(error.message)) fail('P0001');
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        const raced = await this.db
          .prepare('SELECT * FROM founding100_reservations WHERE idempotency_key=?')
          .bind(input.idempotencyKey)
          .first<Reservation>();
        if (raced?.status === 'reserved' && raced.expires_at > now)
          return this.reservation(raced, true);
        if (raced) fail('P0004');
      }
      throw error;
    }
  }
  async confirm(
    input: Parameters<Founding100Repository['confirm']>[0],
  ): Promise<Founding100ConfirmResult> {
    if (!/^[a-f0-9]{64}$/.test(input.tokenHash)) fail('22023');
    const row = await this.db
      .prepare('SELECT * FROM founding100_reservations WHERE token_hash=?')
      .bind(input.tokenHash)
      .first<Reservation>();
    if (!row) fail('P0002');
    const now = input.now.toISOString();
    if (row.status === 'confirmed') {
      if (row.user_id !== input.userId) fail('P0003');
      await this.recordEvent({
        eventName: 'telegram_start',
        source: row.source,
        reservationId: row.id,
        dedupeKey: `telegram_start:${row.id}`,
        now: input.now,
      });
      return { reservationId: row.id, duplicate: true };
    }
    if (row.status !== 'reserved' || row.expires_at <= now) fail('P0003');
    const prior = await this.db
      .prepare(
        `SELECT id FROM founding100_reservations
      WHERE user_id=? AND status='confirmed'`,
      )
      .bind(input.userId)
      .first<{ id: string }>();
    if (prior) {
      await this.db
        .prepare(
          `UPDATE founding100_reservations SET status='released',released_at=?
        WHERE id=? AND status='reserved' AND expires_at>?`,
        )
        .bind(now, row.id, now)
        .run();
      await this.recordEvent({
        eventName: 'telegram_start',
        source: row.source,
        reservationId: row.id,
        dedupeKey: `telegram_start:${row.id}`,
        now: input.now,
      });
      return { reservationId: prior.id, duplicate: true };
    }
    try {
      const updated = await this.db
        .prepare(
          `UPDATE founding100_reservations SET status='confirmed',
        user_id=?,confirmed_at=? WHERE id=? AND status='reserved' AND expires_at>? RETURNING id`,
        )
        .bind(input.userId, now, row.id, now)
        .first<{ id: string }>();
      if (updated) return { reservationId: updated.id, duplicate: false };
    } catch (error) {
      if (!(error instanceof Error) || !/UNIQUE|confirmed/i.test(error.message)) throw error;
    }
    const raced = await this.db
      .prepare('SELECT * FROM founding100_reservations WHERE token_hash=?')
      .bind(input.tokenHash)
      .first<Reservation>();
    if (raced?.status === 'confirmed' && raced.user_id === input.userId)
      return { reservationId: raced.id, duplicate: true };
    const other = await this.db
      .prepare(
        `SELECT id FROM founding100_reservations WHERE user_id=?
      AND status='confirmed'`,
      )
      .bind(input.userId)
      .first<{ id: string }>();
    if (other && raced?.status === 'reserved') {
      await this.db
        .prepare(
          `UPDATE founding100_reservations SET status='released',released_at=?
        WHERE id=? AND status='reserved' AND expires_at>?`,
        )
        .bind(now, raced.id, now)
        .run();
      await this.recordEvent({
        eventName: 'telegram_start',
        source: raced.source,
        reservationId: raced.id,
        dedupeKey: `telegram_start:${raced.id}`,
        now: input.now,
      });
      return { reservationId: other.id, duplicate: true };
    }
    fail('P0003');
  }
  async recordEvent(input: Parameters<Founding100Repository['recordEvent']>[0]): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO founding100_events(event_name,reservation_id,source,dedupe_key,
      visitor_hash,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .bind(
        input.eventName,
        input.reservationId ?? null,
        input.source,
        input.dedupeKey ?? null,
        input.visitorHash ?? null,
        input.now.toISOString(),
      )
      .run();
  }
  async recordOnboardingComplete(userId: string, now: Date): Promise<boolean> {
    const reservation = await this.db
      .prepare(
        `SELECT id,source FROM founding100_reservations
      WHERE user_id=? AND status='confirmed' ORDER BY confirmed_at DESC LIMIT 1`,
      )
      .bind(userId)
      .first<{ id: string; source: string }>();
    if (!reservation) return false;
    await this.recordEvent({
      eventName: 'onboarding_complete',
      reservationId: reservation.id,
      source: reservation.source,
      dedupeKey: `onboarding_complete:${reservation.id}`,
      now,
    });
    return true;
  }
  async getAnalytics(input: { from: Date; to: Date }): Promise<Founding100Analytics> {
    if (input.from >= input.to || input.to.getTime() - input.from.getTime() > 366 * 86400000)
      fail('22023');
    const from = input.from.toISOString(),
      to = input.to.toISOString();
    const counts = `count(*) FILTER (WHERE event_name='beta_page_view') pageViews,
      count(DISTINCT CASE WHEN event_name='beta_page_view' THEN visitor_hash END) uniqueVisitors,
      count(*) FILTER (WHERE event_name='beta_cta_click') ctaClicks,
      count(*) FILTER (WHERE event_name='beta_slot_reserved') reservations,
      count(*) FILTER (WHERE event_name='telegram_opened') telegramOpened,
      count(*) FILTER (WHERE event_name='beta_confirmed') confirmed,
      count(*) FILTER (WHERE event_name='onboarding_complete') onboardingCompleted`;
    const totals = required(
      await this.db
        .prepare(
          `SELECT ${counts} FROM founding100_events
      WHERE created_at>=? AND created_at<?`,
        )
        .bind(from, to)
        .first<Founding100Analytics['totals']>(),
    );
    const sources = (
      await this.db
        .prepare(
          `SELECT source,${counts} FROM founding100_events
      WHERE created_at>=? AND created_at<? GROUP BY source ORDER BY pageViews DESC,source`,
        )
        .bind(from, to)
        .all<Founding100AnalyticsSource>()
    ).results.map((row) => ({
      source: row.source,
      pageViews: row.pageViews,
      uniqueVisitors: row.uniqueVisitors,
      reservations: row.reservations,
      confirmed: row.confirmed,
    }));
    const daily = (
      await this.db
        .prepare(
          `SELECT substr(created_at,1,10) date,${counts}
      FROM founding100_events WHERE created_at>=? AND created_at<? GROUP BY substr(created_at,1,10)
      ORDER BY date`,
        )
        .bind(from, to)
        .all<Founding100AnalyticsDay>()
    ).results.map((row) => ({
      date: row.date,
      pageViews: row.pageViews,
      uniqueVisitors: row.uniqueVisitors,
      reservations: row.reservations,
      confirmed: row.confirmed,
    }));
    return { range: { from, to }, totals, sources, daily };
  }
  private reservation(row: Reservation, duplicate: boolean): Founding100ReservationRow {
    return {
      id: row.id,
      expiresAt: row.expires_at,
      status: 'reserved',
      source: row.source,
      duplicate,
    };
  }
}
