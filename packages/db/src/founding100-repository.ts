export interface Founding100Status {
  limit: number;
  confirmed: number;
  reserved: number;
  available: number;
  isOpen: boolean;
}

export interface Founding100ReservationRow {
  id: string;
  expiresAt: string;
  status: 'reserved';
  source: string;
  duplicate: boolean;
}

export interface Founding100ConfirmResult {
  reservationId: string;
  duplicate: boolean;
}

export interface Founding100AnalyticsTotals {
  pageViews: number;
  uniqueVisitors: number;
  ctaClicks: number;
  reservations: number;
  telegramOpened: number;
  confirmed: number;
  onboardingCompleted: number;
}

export interface Founding100AnalyticsSource {
  source: string;
  pageViews: number;
  uniqueVisitors: number;
  reservations: number;
  confirmed: number;
}

export interface Founding100AnalyticsDay {
  date: string;
  pageViews: number;
  uniqueVisitors: number;
  reservations: number;
  confirmed: number;
}

export interface Founding100Analytics {
  range: { from: string; to: string };
  totals: Founding100AnalyticsTotals;
  sources: Founding100AnalyticsSource[];
  daily: Founding100AnalyticsDay[];
}

export type Founding100EventName =
  | 'beta_page_view'
  | 'beta_cta_click'
  | 'beta_slot_reserved'
  | 'telegram_opened'
  | 'telegram_start'
  | 'beta_confirmed'
  | 'onboarding_complete';

export interface Founding100Repository {
  getStatus(now: Date): Promise<Founding100Status>;
  reserve(input: {
    tokenHash: string;
    idempotencyKey: string;
    source: string;
    now: Date;
  }): Promise<Founding100ReservationRow>;
  confirm(input: {
    tokenHash: string;
    userId: string;
    now: Date;
  }): Promise<Founding100ConfirmResult>;
  recordEvent(input: {
    eventName: Founding100EventName;
    source: string;
    reservationId?: string | undefined;
    dedupeKey?: string | undefined;
    visitorHash?: string | undefined;
    now: Date;
  }): Promise<void>;
  recordOnboardingComplete(userId: string, now: Date): Promise<boolean>;
  getAnalytics(input: { from: Date; to: Date }): Promise<Founding100Analytics>;
}
