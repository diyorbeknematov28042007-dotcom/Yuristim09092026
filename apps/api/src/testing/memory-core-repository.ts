import { randomUUID } from 'node:crypto';
import {
  DuplicateDuidError,
  DuplicateTelegramUserError,
  type CoreRepository,
  type LoginRequestRow,
  type SessionRow,
  type TelegramIdentityInput,
  type UserRow,
  type UserTagRow,
  type UserUpdate,
} from '@yuristim/db';

export class MemoryCoreRepository implements CoreRepository {
  readonly users = new Map<string, UserRow>();
  readonly sessions = new Map<string, SessionRow>();
  readonly loginRequests = new Map<string, LoginRequestRow>();
  readonly tags = new Map<string, UserTagRow>();
  readonly approvedLawyerUserIds = new Set<string>();

  findUserById(id: string): Promise<UserRow | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  findUserByDuid(duid: string): Promise<UserRow | null> {
    return Promise.resolve([...this.users.values()].find((user) => user.duid === duid) ?? null);
  }

  findUserByTelegramId(telegramUserId: number): Promise<UserRow | null> {
    return Promise.resolve(
      [...this.users.values()].find((user) => user.telegram_user_id === telegramUserId) ?? null,
    );
  }

  createTelegramUser(identity: TelegramIdentityInput, duid: string): Promise<UserRow> {
    if ([...this.users.values()].some((user) => user.duid === duid)) {
      throw new DuplicateDuidError();
    }
    if (
      [...this.users.values()].some((user) => user.telegram_user_id === identity.telegramUserId)
    ) {
      throw new DuplicateTelegramUserError();
    }
    const timestamp = new Date().toISOString();
    const user: UserRow = {
      active_mode: 'user',
      created_at: timestamp,
      duid,
      full_name: null,
      id: randomUUID(),
      language: null,
      onboarding_role: null,
      onboarding_status: 'language_selection',
      pin_failed_attempts: 0,
      pin_hash: null,
      pin_locked_until: null,
      status: 'active',
      telegram_first_name: identity.telegramFirstName,
      telegram_user_id: identity.telegramUserId,
      telegram_username: identity.telegramUsername,
      terms_accepted_at: null,
      terms_version: null,
      updated_at: timestamp,
    };
    this.users.set(user.id, user);
    return Promise.resolve(user);
  }

  updateTelegramMetadata(id: string, identity: TelegramIdentityInput): Promise<UserRow> {
    return this.updateUser(id, {
      telegram_first_name: identity.telegramFirstName,
      telegram_username: identity.telegramUsername,
    });
  }

  updateUser(id: string, update: UserUpdate): Promise<UserRow> {
    const existing = this.users.get(id);
    if (!existing) throw new Error('User not found');
    const user = { ...existing, ...update, updated_at: new Date().toISOString() };
    this.users.set(id, user);
    return Promise.resolve(user);
  }

  listUserTags(userId: string, now: Date): Promise<UserTagRow[]> {
    return Promise.resolve(
      [...this.tags.values()].filter(
        (tag) =>
          tag.user_id === userId &&
          (tag.expires_at === null || new Date(tag.expires_at).getTime() > now.getTime()),
      ),
    );
  }

  isLawyerApproved(userId: string): Promise<boolean> {
    return Promise.resolve(this.approvedLawyerUserIds.has(userId));
  }

  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<SessionRow> {
    const session: SessionRow = {
      created_at: input.now.toISOString(),
      expires_at: input.expiresAt.toISOString(),
      id: randomUUID(),
      last_seen_at: input.now.toISOString(),
      revoked_at: null,
      token_hash: input.tokenHash,
      user_id: input.userId,
    };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    return Promise.resolve(
      [...this.sessions.values()].find((session) => session.token_hash === tokenHash) ?? null,
    );
  }

  touchSession(id: string, now: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session) this.sessions.set(id, { ...session, last_seen_at: now.toISOString() });
    return Promise.resolve();
  }

  revokeSession(id: string, now: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session?.revoked_at === null) {
      this.sessions.set(id, { ...session, revoked_at: now.toISOString() });
    }
    return Promise.resolve();
  }

  createLoginRequest(input: {
    id: string;
    challengeHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<LoginRequestRow> {
    const request: LoginRequestRow = {
      challenge_hash: input.challengeHash,
      confirmed_at: null,
      consumed_at: null,
      created_at: input.now.toISOString(),
      expires_at: input.expiresAt.toISOString(),
      id: input.id,
      status: 'pending',
      user_id: null,
    };
    this.loginRequests.set(request.id, request);
    return Promise.resolve(request);
  }

  findLoginRequestById(id: string): Promise<LoginRequestRow | null> {
    return Promise.resolve(this.loginRequests.get(id) ?? null);
  }

  findLoginRequestByChallengeHash(challengeHash: string): Promise<LoginRequestRow | null> {
    return Promise.resolve(
      [...this.loginRequests.values()].find(
        (request) => request.challenge_hash === challengeHash,
      ) ?? null,
    );
  }

  confirmLoginRequest(input: {
    id: string;
    challengeHash: string;
    userId: string;
    now: Date;
  }): Promise<LoginRequestRow | null> {
    const request = this.loginRequests.get(input.id);
    if (
      !request ||
      request.challenge_hash !== input.challengeHash ||
      request.status !== 'pending' ||
      new Date(request.expires_at).getTime() <= input.now.getTime()
    ) {
      return Promise.resolve(null);
    }
    const confirmed: LoginRequestRow = {
      ...request,
      confirmed_at: input.now.toISOString(),
      status: 'confirmed',
      user_id: input.userId,
    };
    this.loginRequests.set(request.id, confirmed);
    return Promise.resolve(confirmed);
  }

  consumeLoginRequest(input: {
    id: string;
    challengeHash: string;
    now: Date;
  }): Promise<LoginRequestRow | null> {
    const request = this.loginRequests.get(input.id);
    if (
      !request ||
      request.challenge_hash !== input.challengeHash ||
      request.status !== 'confirmed' ||
      new Date(request.expires_at).getTime() <= input.now.getTime()
    ) {
      return Promise.resolve(null);
    }
    const consumed: LoginRequestRow = {
      ...request,
      consumed_at: input.now.toISOString(),
      status: 'consumed',
    };
    this.loginRequests.set(request.id, consumed);
    return Promise.resolve(consumed);
  }

  expireLoginRequest(id: string): Promise<void> {
    const request = this.loginRequests.get(id);
    if (request && ['pending', 'confirmed'].includes(request.status)) {
      this.loginRequests.set(id, { ...request, status: 'expired' });
    }
    return Promise.resolve();
  }

  seedUser(overrides: Partial<UserRow> = {}): UserRow {
    const timestamp = new Date().toISOString();
    const user: UserRow = {
      active_mode: 'user',
      created_at: timestamp,
      duid: `yr_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      full_name: null,
      id: randomUUID(),
      language: null,
      onboarding_role: null,
      onboarding_status: 'language_selection',
      pin_failed_attempts: 0,
      pin_hash: null,
      pin_locked_until: null,
      status: 'active',
      telegram_first_name: 'Test',
      telegram_user_id: Math.floor(Math.random() * 1_000_000) + 1,
      telegram_username: 'test_user',
      terms_accepted_at: null,
      terms_version: null,
      updated_at: timestamp,
      ...overrides,
    };
    this.users.set(user.id, user);
    return user;
  }
}
