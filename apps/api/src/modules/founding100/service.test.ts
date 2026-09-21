import { describe, expect, it } from 'vitest';
import type {
  Founding100ConfirmResult,
  Founding100Repository,
  Founding100ReservationRow,
  Founding100Status,
} from '@yuristim/db';
import { Founding100Service, normalizeFounding100Source } from './service.js';

class MemoryFounding100Repository implements Founding100Repository {
  private reservations = new Map<
    string,
    {
      id: string;
      tokenHash: string;
      expiresAt: Date;
      status: 'reserved' | 'confirmed';
      userId?: string;
    }
  >();
  private sequence = 0;
  private lock: Promise<void> = Promise.resolve();

  private async exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.lock;
    let release = () => undefined;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async getStatus(now: Date): Promise<Founding100Status> {
    const values = [...this.reservations.values()];
    const confirmed = values.filter((row) => row.status === 'confirmed').length;
    const reserved = values.filter(
      (row) => row.status === 'reserved' && row.expiresAt.getTime() > now.getTime(),
    ).length;
    const available = Math.max(100 - confirmed - reserved, 0);
    return { available, confirmed, isOpen: available > 0, limit: 100, reserved };
  }

  async reserve(input: {
    tokenHash: string;
    idempotencyKey: string;
    source: string;
    now: Date;
  }): Promise<Founding100ReservationRow> {
    return this.exclusive(async () => {
      const existing = this.reservations.get(input.idempotencyKey);
      if (existing && existing.status === 'reserved' && existing.expiresAt > input.now) {
        return {
          duplicate: true,
          expiresAt: existing.expiresAt.toISOString(),
          id: existing.id,
          source: input.source,
          status: 'reserved',
        };
      }
      const status = await this.getStatus(input.now);
      if (!status.isOpen) {
        throw Object.assign(new Error('full'), { databaseCode: 'P0001' });
      }
      this.sequence += 1;
      const row = {
        expiresAt: new Date(input.now.getTime() + 600_000),
        id: `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`,
        status: 'reserved' as const,
        tokenHash: input.tokenHash,
      };
      this.reservations.set(input.idempotencyKey, row);
      return {
        duplicate: false,
        expiresAt: row.expiresAt.toISOString(),
        id: row.id,
        source: input.source,
        status: 'reserved',
      };
    });
  }

  async confirm(): Promise<Founding100ConfirmResult> {
    throw new Error('not needed');
  }

  async recordEvent(): Promise<void> {}

  async recordOnboardingComplete(): Promise<boolean> {
    return false;
  }
}

describe('Founding100Service', () => {
  it('normalizes campaign sources safely', () => {
    expect(normalizeFounding100Source('  Creator_01 !! ')).toBe('creator_01');
    expect(normalizeFounding100Source('')).toBe('direct');
    expect(normalizeFounding100Source(null)).toBe('direct');
  });

  it('returns the same server-derived Telegram token for an idempotent retry', async () => {
    const now = new Date('2026-09-21T18:51:00.000Z');
    const service = new Founding100Service(new MemoryFounding100Repository(), {
      now: () => now,
      tokenSecret: 'x'.repeat(64),
    });

    const first = await service.reserve('request-12345678', 'instagram');
    const duplicate = await service.reserve('request-12345678', 'instagram');

    expect(duplicate.reservation.id).toBe(first.reservation.id);
    expect(duplicate.reservation.startParameter).toBe(
      first.reservation.startParameter,
    );
    expect(first.reservation.startParameter).toMatch(/^f100_[A-Za-z0-9_-]{43}$/);
  });

  it('never admits more than 100 simultaneous reservations under concurrency', async () => {
    const now = new Date('2026-09-21T18:51:00.000Z');
    const service = new Founding100Service(new MemoryFounding100Repository(), {
      now: () => now,
      tokenSecret: 'y'.repeat(64),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 109 }, (_, index) =>
        service.reserve(`race-${String(index).padStart(8, '0')}`, 'tsul'),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
      100,
    );
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(9);
    const status = await service.status();
    expect(status.available).toBe(0);
    expect(status.confirmed + status.reserved).toBe(100);
  });
});
