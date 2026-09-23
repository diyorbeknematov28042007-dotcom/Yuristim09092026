import type { Database, Json } from './database.types.js';

export type UserRow = Database['public']['Tables']['users']['Row'];
export type UserUpdate = Database['public']['Tables']['users']['Update'];
export type SessionRow = Database['public']['Tables']['auth_sessions']['Row'];
export type LoginRequestRow = Database['public']['Tables']['auth_login_requests']['Row'];
export type UserTagRow = Database['public']['Tables']['user_tags']['Row'];

export interface TelegramIdentityInput {
  telegramUserId: number;
  telegramUsername: string | null;
  telegramFirstName: string | null;
}

export class DuplicateDuidError extends Error {
  constructor() {
    super('DUID already exists');
    this.name = 'DuplicateDuidError';
  }
}

export class DuplicateTelegramUserError extends Error {
  constructor() {
    super('Telegram user already exists');
    this.name = 'DuplicateTelegramUserError';
  }
}

export interface CoreRepository {
  findUserById(id: string): Promise<UserRow | null>;
  findUserByDuid(duid: string): Promise<UserRow | null>;
  findUserByTelegramId(telegramUserId: number): Promise<UserRow | null>;
  createTelegramUser(identity: TelegramIdentityInput, duid: string): Promise<UserRow>;
  updateTelegramMetadata(id: string, identity: TelegramIdentityInput): Promise<UserRow>;
  updateUser(id: string, update: UserUpdate): Promise<UserRow>;
  listUserTags(userId: string, now: Date): Promise<UserTagRow[]>;
  isLawyerApproved(userId: string): Promise<boolean>;

  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<SessionRow>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  touchSession(id: string, now: Date): Promise<void>;
  revokeSession(id: string, now: Date): Promise<void>;

  createLoginRequest(input: {
    id: string;
    challengeHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<LoginRequestRow>;
  findLoginRequestById(id: string): Promise<LoginRequestRow | null>;
  findLoginRequestByChallengeHash(challengeHash: string): Promise<LoginRequestRow | null>;
  confirmLoginRequest(input: {
    id: string;
    challengeHash: string;
    userId: string;
    now: Date;
  }): Promise<LoginRequestRow | null>;
  consumeLoginRequest(input: {
    id: string;
    challengeHash: string;
    now: Date;
  }): Promise<LoginRequestRow | null>;
  expireLoginRequest(id: string): Promise<void>;
}

export function jsonObject(value: Json): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object' ? value : {};
}
