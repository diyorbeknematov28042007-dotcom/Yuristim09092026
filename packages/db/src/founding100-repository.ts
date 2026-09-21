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
    now: Date;
  }): Promise<void>;
  recordOnboardingComplete(userId: string, now: Date): Promise<boolean>;
}
