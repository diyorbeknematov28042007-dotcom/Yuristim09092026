/* Database functions are introduced by the Founding 100 migration before generated types are refreshed. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import type {
  Founding100Analytics,
  Founding100AnalyticsDay,
  Founding100AnalyticsSource,
  Founding100ConfirmResult,
  Founding100Repository,
  Founding100ReservationRow,
  Founding100Status,
} from './founding100-repository.js';

type LooseClient = SupabaseClient<any>;

function fail(error: PostgrestError): never {
  throw Object.assign(new Error(`Database operation failed (${error.code})`), {
    databaseCode: error.code,
    databaseMessage: error.message,
  });
}

function requireObject(data: unknown, error: PostgrestError | null): Record<string, any> {
  if (error) fail(error);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Database operation returned malformed data');
  }
  return data as Record<string, any>;
}

function statusView(value: Record<string, any>): Founding100Status {
  return {
    available: Number(value.available),
    confirmed: Number(value.confirmed),
    isOpen: Boolean(value.isOpen),
    limit: Number(value.limit),
    reserved: Number(value.reserved),
  };
}

function analyticsView(value: Record<string, any>): Founding100Analytics {
  const range = requireObject(value.range, null);
  const totals = requireObject(value.totals, null);
  const sources = Array.isArray(value.sources) ? value.sources : [];
  const daily = Array.isArray(value.daily) ? value.daily : [];
  const sourceView = (row: unknown): Founding100AnalyticsSource => {
    const item = requireObject(row, null);
    return {
      confirmed: Number(item.confirmed),
      pageViews: Number(item.pageViews),
      reservations: Number(item.reservations),
      source: String(item.source),
      uniqueVisitors: Number(item.uniqueVisitors),
    };
  };
  const dayView = (row: unknown): Founding100AnalyticsDay => {
    const item = requireObject(row, null);
    return {
      confirmed: Number(item.confirmed),
      date: String(item.date),
      pageViews: Number(item.pageViews),
      reservations: Number(item.reservations),
      uniqueVisitors: Number(item.uniqueVisitors),
    };
  };

  return {
    daily: daily.map(dayView),
    range: { from: String(range.from), to: String(range.to) },
    sources: sources.map(sourceView),
    totals: {
      confirmed: Number(totals.confirmed),
      ctaClicks: Number(totals.ctaClicks),
      onboardingCompleted: Number(totals.onboardingCompleted),
      pageViews: Number(totals.pageViews),
      reservations: Number(totals.reservations),
      telegramOpened: Number(totals.telegramOpened),
      uniqueVisitors: Number(totals.uniqueVisitors),
    },
  };
}

export class SupabaseFounding100Repository implements Founding100Repository {
  private readonly client: LooseClient;

  constructor(client: SupabaseClient<Database>) {
    this.client = client as LooseClient;
  }

  async getStatus(now: Date): Promise<Founding100Status> {
    const { data, error } = await this.client.rpc('founding100_status', {
      p_now: now.toISOString(),
    });
    return statusView(requireObject(data, error));
  }

  async reserve(input: {
    tokenHash: string;
    idempotencyKey: string;
    source: string;
    now: Date;
  }): Promise<Founding100ReservationRow> {
    const { data, error } = await this.client.rpc('reserve_founding100_slot', {
      p_idempotency_key: input.idempotencyKey,
      p_now: input.now.toISOString(),
      p_source: input.source,
      p_token_hash: input.tokenHash,
    });
    const value = requireObject(data, error);
    if (value.status !== 'reserved') throw new Error('Unexpected Founding 100 reservation state');

    return {
      duplicate: Boolean(value.duplicate),
      expiresAt: String(value.expiresAt),
      id: String(value.id),
      source: String(value.source),
      status: 'reserved',
    };
  }

  async confirm(input: {
    tokenHash: string;
    userId: string;
    now: Date;
  }): Promise<Founding100ConfirmResult> {
    const { data, error } = await this.client.rpc('confirm_founding100_reservation', {
      p_now: input.now.toISOString(),
      p_token_hash: input.tokenHash,
      p_user_id: input.userId,
    });
    const value = requireObject(data, error);
    return {
      duplicate: Boolean(value.duplicate),
      reservationId: String(value.reservationId),
    };
  }

  async recordEvent(input: Parameters<Founding100Repository['recordEvent']>[0]): Promise<void> {
    const { error } = await this.client.rpc('record_founding100_event', {
      p_dedupe_key: input.dedupeKey ?? null,
      p_event_name: input.eventName,
      p_now: input.now.toISOString(),
      p_reservation_id: input.reservationId ?? null,
      p_source: input.source,
      p_visitor_hash: input.visitorHash ?? null,
    });
    if (error) fail(error);
  }

  async recordOnboardingComplete(userId: string, now: Date): Promise<boolean> {
    const { data, error } = await this.client.rpc('record_founding100_onboarding_complete', {
      p_now: now.toISOString(),
      p_user_id: userId,
    });
    if (error) fail(error);
    return Boolean(data);
  }

  async getAnalytics(input: { from: Date; to: Date }): Promise<Founding100Analytics> {
    const { data, error } = await this.client.rpc('founding100_analytics', {
      p_from: input.from.toISOString(),
      p_to: input.to.toISOString(),
    });
    return analyticsView(requireObject(data, error));
  }
}
