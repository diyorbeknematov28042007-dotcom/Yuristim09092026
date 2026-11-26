import type { Database } from './database.types.js';
import type {
  AdminAccountRow,
  AdminSessionRow,
  AdminUserStats,
  LawyerRepository,
} from './lawyer-repository.js';

type Value = string | number | null;
interface Statement {
  bind(...values: Value[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1AdminBinding {
  prepare(sql: string): Statement;
}

type AdminMethods = Pick<
  LawyerRepository,
  | 'findAdminByUsername'
  | 'findAdminById'
  | 'createAdmin'
  | 'updateAdminLoginState'
  | 'createAdminSession'
  | 'findAdminSessionByTokenHash'
  | 'touchAdminSession'
  | 'revokeAdminSession'
  | 'logAdminLogin'
  | 'getAdminUserStats'
>;

function required<T>(row: T | null): T {
  if (!row) throw new Error('D1 row missing');
  return row;
}

// Match the existing admin dashboard's Asia/Tashkent reporting window.
function startOfTashkentDay(now: Date, daysAgo = 0): string {
  const offset = 5 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + offset);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      offset -
      daysAgo * 86_400_000,
  ).toISOString();
}

export class D1AdminRepository implements AdminMethods {
  constructor(private readonly db: D1AdminBinding) {}

  findAdminByUsername(username: string): Promise<AdminAccountRow | null> {
    return this.db
      .prepare('SELECT * FROM admin_accounts WHERE username=?')
      .bind(username)
      .first<AdminAccountRow>();
  }
  findAdminById(id: string): Promise<AdminAccountRow | null> {
    return this.db
      .prepare('SELECT * FROM admin_accounts WHERE id=?')
      .bind(id)
      .first<AdminAccountRow>();
  }
  async createAdmin(username: string, passwordHash: string): Promise<AdminAccountRow> {
    return required(
      await this.db
        .prepare('INSERT INTO admin_accounts(id,username,password_hash) VALUES(?,?,?) RETURNING *')
        .bind(crypto.randomUUID(), username, passwordHash)
        .first<AdminAccountRow>(),
    );
  }
  async updateAdminLoginState(
    id: string,
    update: Database['public']['Tables']['admin_accounts']['Update'],
  ): Promise<AdminAccountRow> {
    if (
      Object.keys(update).some(
        (key) => !['failed_login_attempts', 'last_login_at', 'locked_until'].includes(key),
      ) ||
      (update.failed_login_attempts !== undefined &&
        (!Number.isInteger(update.failed_login_attempts) ||
          update.failed_login_attempts < 0 ||
          update.failed_login_attempts > 5))
    )
      throw new Error('Unsupported admin login state update');
    // The login service passes the observed counter. Increment in SQLite so
    // concurrent failures cannot all write the same stale value back.
    if (update.failed_login_attempts !== undefined && update.failed_login_attempts > 0) {
      if (!update.locked_until && update.failed_login_attempts >= 5)
        throw new Error('Missing admin lock expiry');
      return required(
        await this.db
          .prepare(
            `UPDATE admin_accounts SET failed_login_attempts=MIN(failed_login_attempts+1,5),
            locked_until=CASE WHEN failed_login_attempts>=4 THEN ? ELSE NULL END,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id=? AND status='active' AND (locked_until IS NULL OR locked_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            RETURNING *`,
          )
          // The service sends the lock timestamp on its fifth observed failure.
          // Earlier concurrent failures may cross the threshold first; calculate
          // an equivalent expiry from the service's clock at the call site below.
          .bind(update.locked_until ?? new Date(Date.now() + 15 * 60_000).toISOString(), id)
          .first<AdminAccountRow>(),
      );
    }
    if (update.failed_login_attempts !== 0 || !update.last_login_at || update.locked_until !== null)
      throw new Error('Unsupported admin login state update');
    return required(
      await this.db
        .prepare(
          `UPDATE admin_accounts SET failed_login_attempts=0,locked_until=NULL,
          last_login_at=?,updated_at=? WHERE id=? AND status='active' RETURNING *`,
        )
        .bind(update.last_login_at, update.last_login_at, id)
        .first<AdminAccountRow>(),
    );
  }
  async createAdminSession(input: {
    adminId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
  }): Promise<AdminSessionRow> {
    return required(
      await this.db
        .prepare(
          `INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,expires_at,last_seen_at)
          SELECT ?,id,?,?,?,? FROM admin_accounts WHERE id=? AND status='active' RETURNING *`,
        )
        .bind(
          crypto.randomUUID(),
          input.tokenHash,
          input.now.toISOString(),
          input.expiresAt.toISOString(),
          input.now.toISOString(),
          input.adminId,
        )
        .first<AdminSessionRow>(),
    );
  }
  findAdminSessionByTokenHash(tokenHash: string): Promise<AdminSessionRow | null> {
    return this.db
      .prepare('SELECT * FROM admin_sessions WHERE token_hash=?')
      .bind(tokenHash)
      .first<AdminSessionRow>();
  }
  async touchAdminSession(id: string, now: Date): Promise<void> {
    await this.db
      .prepare(
        `UPDATE admin_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL
        AND expires_at>? AND EXISTS(SELECT 1 FROM admin_accounts a WHERE a.id=admin_id AND a.status='active')`,
      )
      .bind(now.toISOString(), id, now.toISOString())
      .run();
  }
  async revokeAdminSession(id: string, now: Date): Promise<void> {
    await this.db
      .prepare('UPDATE admin_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL')
      .bind(now.toISOString(), id)
      .run();
  }
  async logAdminLogin(input: {
    adminId: string | null;
    username: string;
    success: boolean;
    ip: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO admin_login_logs(id,admin_id,username,success,ip,user_agent,created_at)
        VALUES(?,?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.adminId,
        input.username,
        input.success ? 1 : 0,
        input.ip,
        input.userAgent?.slice(0, 512) ?? null,
        input.now.toISOString(),
      )
      .run();
  }
  async getAdminUserStats(now: Date): Promise<AdminUserStats> {
    const [counts, recent] = await Promise.all([
      this.db
        .prepare(
          `SELECT COUNT(*) AS total,COUNT(*) FILTER (WHERE created_at>=?) AS today,
          COUNT(*) FILTER (WHERE created_at>=?) AS last7,
          COUNT(*) FILTER (WHERE created_at>=?) AS last30 FROM users`,
        )
        .bind(startOfTashkentDay(now), startOfTashkentDay(now, 6), startOfTashkentDay(now, 29))
        .first<{ total: number; today: number; last7: number; last30: number }>(),
      this.db
        .prepare(
          `SELECT id,duid,full_name,telegram_first_name,telegram_username,
          onboarding_role,language,status,created_at,updated_at
          FROM users ORDER BY created_at DESC LIMIT 10`,
        )
        .all<{
          id: string;
          duid: string;
          full_name: string | null;
          telegram_first_name: string | null;
          telegram_username: string | null;
          onboarding_role: string | null;
          language: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        }>(),
    ]);
    return {
      totalUsers: counts?.total ?? 0,
      todayUsers: counts?.today ?? 0,
      last7DaysUsers: counts?.last7 ?? 0,
      last30DaysUsers: counts?.last30 ?? 0,
      recentUsers: recent.results.map((user) => ({
        id: user.id,
        duid: user.duid,
        name: user.full_name ?? user.telegram_first_name,
        telegramUsername: user.telegram_username,
        role: user.onboarding_role,
        language: user.language,
        status: user.status,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      })),
    };
  }
}
