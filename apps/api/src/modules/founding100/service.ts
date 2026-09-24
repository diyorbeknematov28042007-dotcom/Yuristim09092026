import { createHash, createHmac } from 'node:crypto';
import type {
  Founding100Analytics,
  Founding100ConfirmResult,
  Founding100EventName,
  Founding100Repository,
  Founding100Status,
} from '@yuristim/db';
import { AppError } from '../../lib/errors.js';

const FRONTEND_EVENTS = new Set<Founding100EventName>([
  'beta_page_view',
  'beta_cta_click',
  'beta_slot_reserved',
  'telegram_opened',
]);

function databaseDetails(error: unknown): { code?: string; message: string } {
  if (!(error instanceof Error)) return { message: '' };
  const value = error as Error & { databaseCode?: string; databaseMessage?: string };
  return {
    ...(value.databaseCode ? { code: value.databaseCode } : {}),
    message: value.databaseMessage ?? value.message,
  };
}

function founding100Error(error: unknown): never {
  const details = databaseDetails(error);
  if (details.code === 'P0001') {
    throw new AppError(409, 'FOUNDING100_FULL', 'Founding 100 capacity is currently full');
  }
  if (details.code === 'P0002') {
    throw new AppError(404, 'FOUNDING100_RESERVATION_NOT_FOUND', 'Reservation not found');
  }
  if (details.code === 'P0003') {
    throw new AppError(410, 'FOUNDING100_RESERVATION_EXPIRED', 'Reservation has expired');
  }
  if (details.code === 'P0004') {
    throw new AppError(409, 'VALIDATION_ERROR', 'Reservation request is no longer reusable');
  }
  if (details.code === '22023') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Founding 100 input is invalid');
  }
  throw error;
}

export interface Founding100ServiceOptions {
  tokenSecret: string;
  now?: () => Date;
}

export class Founding100Service {
  private readonly now: () => Date;

  constructor(
    private readonly repository: Founding100Repository,
    private readonly options: Founding100ServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  status(): Promise<Founding100Status> {
    return this.repository.getStatus(this.now());
  }

  async reserve(
    idempotencyKey: string,
    sourceInput: string | null | undefined,
  ): Promise<{
    reservation: {
      id: string;
      expiresAt: string;
      startParameter: string;
      status: 'reserved';
    };
    status: Founding100Status;
  }> {
    const source = normalizeFounding100Source(sourceInput);
    const token = this.deriveToken(idempotencyKey);

    try {
      const row = await this.repository.reserve({
        idempotencyKey,
        now: this.now(),
        source,
        tokenHash: hashToken(token),
      });
      return {
        reservation: {
          expiresAt: row.expiresAt,
          id: row.id,
          startParameter: `f100_${token}`,
          status: 'reserved',
        },
        status: await this.repository.getStatus(this.now()),
      };
    } catch (error) {
      founding100Error(error);
    }
  }

  async confirmTelegramStart(token: string, userId: string): Promise<Founding100ConfirmResult> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Founding 100 token is invalid');
    }
    try {
      return await this.repository.confirm({
        now: this.now(),
        tokenHash: hashToken(token),
        userId,
      });
    } catch (error) {
      founding100Error(error);
    }
  }

  async recordFrontendEvent(input: {
    eventName: Founding100EventName;
    source?: string | null | undefined;
    reservationId?: string | undefined;
    visitorId?: string | undefined;
  }): Promise<void> {
    if (!FRONTEND_EVENTS.has(input.eventName)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Event is not accepted from the public client');
    }
    const source = normalizeFounding100Source(input.source);
    const dedupeKey =
      input.reservationId && ['beta_slot_reserved', 'telegram_opened'].includes(input.eventName)
        ? `${input.eventName}:${input.reservationId}`
        : undefined;

    try {
      await this.repository.recordEvent({
        ...(dedupeKey ? { dedupeKey } : {}),
        eventName: input.eventName,
        now: this.now(),
        ...(input.reservationId ? { reservationId: input.reservationId } : {}),
        source,
        ...(input.visitorId ? { visitorHash: this.hashVisitorId(input.visitorId) } : {}),
      });
    } catch (error) {
      founding100Error(error);
    }
  }

  async recordOnboardingComplete(userId: string): Promise<boolean> {
    return this.repository.recordOnboardingComplete(userId, this.now());
  }

  async analytics(days: number): Promise<
    Founding100Analytics & {
      status: Founding100Status;
      conversion: {
        visitorToReservation: number;
        reservationToConfirmation: number;
        visitorToConfirmation: number;
      };
    }
  > {
    const to = this.now();
    const from = new Date(to.getTime() - days * 86_400_000);
    const [analytics, status] = await Promise.all([
      this.repository.getAnalytics({ from, to }),
      this.repository.getStatus(to),
    ]);
    const percent = (value: number, total: number): number =>
      total > 0 ? Math.round((value / total) * 1_000) / 10 : 0;

    return {
      ...analytics,
      conversion: {
        reservationToConfirmation: percent(
          analytics.totals.confirmed,
          analytics.totals.reservations,
        ),
        visitorToConfirmation: percent(analytics.totals.confirmed, analytics.totals.uniqueVisitors),
        visitorToReservation: percent(
          analytics.totals.reservations,
          analytics.totals.uniqueVisitors,
        ),
      },
      status,
    };
  }

  private deriveToken(idempotencyKey: string): string {
    return createHmac('sha256', this.options.tokenSecret)
      .update(`founding100:${idempotencyKey}`)
      .digest('base64url');
  }

  private hashVisitorId(visitorId: string): string {
    return createHmac('sha256', this.options.tokenSecret)
      .update(`founding100:visitor:${visitorId}`)
      .digest('hex');
  }
}

export function normalizeFounding100Source(value: string | null | undefined): string {
  const normalized = (value ?? 'direct')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
  return normalized || 'direct';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
