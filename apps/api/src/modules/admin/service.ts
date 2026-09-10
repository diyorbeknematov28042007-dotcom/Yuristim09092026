import { createHmac, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import {
  jsonObject,
  type AdminAccountRow,
  type AdminSessionRow,
  type LawyerRepository,
  type VerificationRecord,
} from '@yuristim/db';
import type { AdminView } from '@yuristim/types';
import { AppError } from '../../lib/errors.js';

const MAX_ATTEMPTS = 5;
const LOCK_MILLISECONDS = 15 * 60 * 1000;

function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(`admin:${token}`).digest('hex');
}

async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    outputLen: 32,
    parallelism: 1,
    timeCost: 2,
  });
}

export interface IssuedAdminSession {
  admin: AdminAccountRow;
  rawToken: string;
  session: AdminSessionRow;
}

export class AdminService {
  constructor(
    private readonly repository: LawyerRepository,
    private readonly options: {
      sessionSecret: string;
      sessionTtlSeconds: number;
      now?: () => Date;
    },
  ) {}

  private get now(): () => Date {
    return this.options.now ?? (() => new Date());
  }

  async bootstrap(username?: string, password?: string): Promise<void> {
    if (!username && !password) return;
    if (!username || !password)
      throw new Error('Admin bootstrap credentials must be provided together');
    const normalized = username.toLowerCase();
    if (await this.repository.findAdminByUsername(normalized)) return;
    await this.repository.createAdmin(normalized, await hashPassword(password));
  }

  async login(input: {
    username: string;
    password: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<IssuedAdminSession> {
    const now = this.now();
    const username = input.username.toLowerCase();
    const admin = await this.repository.findAdminByUsername(username);
    const locked = Boolean(
      admin?.locked_until && new Date(admin.locked_until).getTime() > now.getTime(),
    );
    const valid = admin
      ? !locked && (await verify(admin.password_hash, input.password).catch(() => false))
      : false;
    await this.repository.logAdminLogin({
      adminId: admin?.id ?? null,
      ip: input.ip,
      now,
      success: Boolean(admin && valid && !locked && admin.status === 'active'),
      userAgent: input.userAgent,
      username,
    });
    if (!admin || admin.status !== 'active')
      throw new AppError(401, 'UNAUTHORIZED', 'Admin credentials are invalid');
    if (locked)
      throw new AppError(429, 'PIN_TEMPORARILY_LOCKED', 'Admin login is temporarily locked');
    if (!valid) {
      const attempts = Math.min(admin.failed_login_attempts + 1, MAX_ATTEMPTS);
      await this.repository.updateAdminLoginState(admin.id, {
        failed_login_attempts: attempts,
        locked_until:
          attempts >= MAX_ATTEMPTS
            ? new Date(now.getTime() + LOCK_MILLISECONDS).toISOString()
            : null,
      });
      throw new AppError(401, 'UNAUTHORIZED', 'Admin credentials are invalid');
    }
    const updated = await this.repository.updateAdminLoginState(admin.id, {
      failed_login_attempts: 0,
      last_login_at: now.toISOString(),
      locked_until: null,
    });
    const rawToken = randomBytes(32).toString('base64url');
    const session = await this.repository.createAdminSession({
      adminId: admin.id,
      expiresAt: new Date(now.getTime() + this.options.sessionTtlSeconds * 1000),
      now,
      tokenHash: hashToken(rawToken, this.options.sessionSecret),
    });
    return { admin: updated, rawToken, session };
  }

  async authenticate(
    rawToken: string,
  ): Promise<{ admin: AdminAccountRow; session: AdminSessionRow }> {
    const now = this.now();
    const session = await this.repository.findAdminSessionByTokenHash(
      hashToken(rawToken, this.options.sessionSecret),
    );
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= now.getTime())
      throw new AppError(401, 'UNAUTHORIZED', 'Admin authentication is required');
    const admin = await this.repository.findAdminById(session.admin_id);
    if (!admin || admin.status !== 'active')
      throw new AppError(403, 'FORBIDDEN', 'Admin account is unavailable');
    await this.repository.touchAdminSession(session.id, now);
    return { admin, session };
  }

  revoke(sessionId: string): Promise<void> {
    return this.repository.revokeAdminSession(sessionId, this.now());
  }
  toView(admin: AdminAccountRow): AdminView {
    return {
      id: admin.id,
      role: admin.role as AdminView['role'],
      status: admin.status as AdminView['status'],
      username: admin.username,
    };
  }

  async listVerifications(input: Parameters<LawyerRepository['listVerifications']>[0]) {
    const result = await this.repository.listVerifications(input);
    return {
      items: result.items.map((item) => this.verificationSummary(item)),
      limit: input.limit,
      page: input.page,
      total: result.total,
    };
  }

  async getVerification(id: string) {
    const record = await this.repository.getVerificationDetail(id);
    if (!record) throw new AppError(404, 'VERIFICATION_NOT_FOUND', 'Verification not found');
    return {
      ...this.verificationSummary(record),
      documents: await Promise.all(
        record.documents.map(async (document) => ({
          id: document.id,
          kind: document.kind,
          mimeType: document.mime_type,
          originalFilename: document.original_filename,
          sizeBytes: document.size_bytes,
          signedUrl: await this.repository.createSignedUrl(
            document.storage_bucket,
            document.storage_path,
            300,
          ),
        })),
      ),
    };
  }

  async review(
    admin: AdminAccountRow,
    verificationId: string,
    decision: 'approved' | 'rejected',
    reason: string | null,
  ): Promise<void> {
    if (admin.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Admin role is required');
    if (decision === 'rejected' && (!reason || reason.trim().length < 3))
      throw new AppError(400, 'VERIFICATION_REJECT_REASON_REQUIRED', 'Reject reason is required');
    const result = await this.repository.reviewVerification({
      adminId: admin.id,
      decision,
      rejectReason: reason?.trim() ?? null,
      verificationId,
    });
    if (result === 'not_found')
      throw new AppError(404, 'VERIFICATION_NOT_FOUND', 'Verification not found');
    if (result === 'conflict')
      throw new AppError(409, 'VERIFICATION_ALREADY_REVIEWED', 'Verification is already reviewed');
  }

  private verificationSummary(record: VerificationRecord) {
    const verification = record.verification;
    return {
      id: verification.id,
      lawyer: {
        duid: record.profile.user.duid,
        fullName: record.profile.user.full_name,
        id: record.profile.profile.id,
      },
      rejectReason: verification.status === 'rejected' ? verification.reject_reason : null,
      status: verification.status,
      submittedAt: verification.submitted_at,
      submittedData: jsonObject(verification.submitted_data),
      type: verification.type,
      reviewedAt: verification.reviewed_at,
    };
  }
}
