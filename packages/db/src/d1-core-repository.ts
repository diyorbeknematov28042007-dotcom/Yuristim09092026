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
} from './repository.js';

type SqlValue = string | number | null;

interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1CoreBinding {
  prepare(query: string): Statement;
}

const userColumns = [
  'full_name',
  'language',
  'active_mode',
  'onboarding_role',
  'onboarding_status',
  'pin_hash',
  'pin_failed_attempts',
  'pin_locked_until',
  'terms_accepted_at',
  'terms_version',
  'status',
  'telegram_first_name',
  'telegram_username',
] as const satisfies ReadonlyArray<keyof UserUpdate>;

function required<T>(row: T | null): T {
  if (row === null) throw new Error('D1 row missing');
  return row;
}

export class D1CoreRepository implements CoreRepository {
  constructor(private readonly db: D1CoreBinding) {}

  findUserById(id: string): Promise<UserRow | null> {
    return this.db.prepare('SELECT * FROM users WHERE id=?').bind(id).first<UserRow>();
  }
  findUserByDuid(duid: string): Promise<UserRow | null> {
    return this.db.prepare('SELECT * FROM users WHERE duid=?').bind(duid).first<UserRow>();
  }
  findUserByTelegramId(id: number): Promise<UserRow | null> {
    return this.db
      .prepare('SELECT * FROM users WHERE telegram_user_id=?')
      .bind(id)
      .first<UserRow>();
  }
  async createTelegramUser(identity: TelegramIdentityInput, duid: string): Promise<UserRow> {
    try {
      return required(
        await this.db
          .prepare(
            'INSERT INTO users(id,telegram_user_id,telegram_username,telegram_first_name,duid) VALUES(?,?,?,?,?) RETURNING *',
          )
          .bind(
            crypto.randomUUID(),
            identity.telegramUserId,
            identity.telegramUsername,
            identity.telegramFirstName,
            duid,
          )
          .first<UserRow>(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('users.duid')) throw new DuplicateDuidError();
      if (message.includes('users.telegram_user_id')) throw new DuplicateTelegramUserError();
      throw error;
    }
  }
  async updateTelegramMetadata(id: string, identity: TelegramIdentityInput): Promise<UserRow> {
    return required(
      await this.db
        .prepare(
          'UPDATE users SET telegram_first_name=?,telegram_username=? WHERE id=? RETURNING *',
        )
        .bind(identity.telegramFirstName, identity.telegramUsername, id)
        .first<UserRow>(),
    );
  }
  async updateUser(id: string, update: UserUpdate): Promise<UserRow> {
    const keys = userColumns.filter((key) => update[key] !== undefined);
    if (
      !keys.length ||
      Object.keys(update).some((key) => !userColumns.includes(key as (typeof userColumns)[number]))
    ) {
      throw new Error('Unsupported user update');
    }
    const values = keys.map((key) => update[key] as SqlValue);
    return required(
      await this.db
        .prepare(
          `UPDATE users SET ${keys.map((key) => `${key}=?`).join(',')} WHERE id=? RETURNING *`,
        )
        .bind(...values, id)
        .first<UserRow>(),
    );
  }
  async listUserTags(userId: string, now: Date): Promise<UserTagRow[]> {
    const rows = (
      await this.db
        .prepare(
          'SELECT * FROM user_tags WHERE user_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at',
        )
        .bind(userId, now.toISOString())
        .all<Omit<UserTagRow, 'metadata'> & { metadata: string }>()
    ).results;
    return rows.map((row) => ({
      ...row,
      metadata: JSON.parse(row.metadata) as UserTagRow['metadata'],
    }));
  }
  async isLawyerApproved(userId: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        "SELECT id FROM lawyer_profiles WHERE user_id=? AND verification_status='approved' LIMIT 1",
      )
      .bind(userId)
      .first<{ id: string }>();
    return row !== null;
  }
  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<SessionRow> {
    return required(
      await this.db
        .prepare(
          'INSERT INTO auth_sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?) RETURNING *',
        )
        .bind(
          crypto.randomUUID(),
          input.userId,
          input.tokenHash,
          input.now.toISOString(),
          input.expiresAt.toISOString(),
          input.now.toISOString(),
        )
        .first<SessionRow>(),
    );
  }
  findSessionByTokenHash(hash: string): Promise<SessionRow | null> {
    return this.db
      .prepare('SELECT * FROM auth_sessions WHERE token_hash=?')
      .bind(hash)
      .first<SessionRow>();
  }
  async touchSession(id: string, now: Date): Promise<void> {
    await this.db
      .prepare('UPDATE auth_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL')
      .bind(now.toISOString(), id)
      .run();
  }
  async revokeSession(id: string, now: Date): Promise<void> {
    await this.db
      .prepare('UPDATE auth_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL')
      .bind(now.toISOString(), id)
      .run();
  }
  async createLoginRequest(input: {
    id: string;
    challengeHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<LoginRequestRow> {
    return required(
      await this.db
        .prepare(
          'INSERT INTO auth_login_requests(id,challenge_hash,created_at,expires_at) VALUES(?,?,?,?) RETURNING *',
        )
        .bind(input.id, input.challengeHash, input.now.toISOString(), input.expiresAt.toISOString())
        .first<LoginRequestRow>(),
    );
  }
  findLoginRequestById(id: string): Promise<LoginRequestRow | null> {
    return this.db
      .prepare('SELECT * FROM auth_login_requests WHERE id=?')
      .bind(id)
      .first<LoginRequestRow>();
  }
  findLoginRequestByChallengeHash(hash: string): Promise<LoginRequestRow | null> {
    return this.db
      .prepare('SELECT * FROM auth_login_requests WHERE challenge_hash=?')
      .bind(hash)
      .first<LoginRequestRow>();
  }
  confirmLoginRequest(input: {
    id: string;
    challengeHash: string;
    userId: string;
    now: Date;
  }): Promise<LoginRequestRow | null> {
    const now = input.now.toISOString();
    return this.db
      .prepare(
        "UPDATE auth_login_requests SET status='confirmed',confirmed_at=?,user_id=? WHERE id=? AND challenge_hash=? AND status='pending' AND expires_at>? RETURNING *",
      )
      .bind(now, input.userId, input.id, input.challengeHash, now)
      .first<LoginRequestRow>();
  }
  consumeLoginRequest(input: {
    id: string;
    challengeHash: string;
    now: Date;
  }): Promise<LoginRequestRow | null> {
    const now = input.now.toISOString();
    return this.db
      .prepare(
        "UPDATE auth_login_requests SET status='consumed',consumed_at=? WHERE id=? AND challenge_hash=? AND status='confirmed' AND expires_at>? RETURNING *",
      )
      .bind(now, input.id, input.challengeHash, now)
      .first<LoginRequestRow>();
  }
  async expireLoginRequest(id: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE auth_login_requests SET status='expired' WHERE id=? AND status IN ('pending','confirmed')",
      )
      .bind(id)
      .run();
  }
}
