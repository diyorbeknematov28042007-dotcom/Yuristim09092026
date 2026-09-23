import { randomUUID } from 'node:crypto';
import type {
  AdminAccountRow,
  AdminSessionRow,
  FileUploadInput,
  Json,
  LawyerProfileRecord,
  LawyerProfileRow,
  LawyerRepository,
  LawyerSearchInput,
  LawyerVerificationRow,
  SpecializationRow,
  VerificationDocumentRow,
  VerificationListInput,
  VerificationRecord,
} from '@yuristim/db';
import type { MemoryCoreRepository } from './memory-core-repository.js';

export class MemoryLawyerRepository implements LawyerRepository {
  readonly profiles = new Map<string, LawyerProfileRow>();
  readonly verifications = new Map<string, LawyerVerificationRow>();
  readonly documents = new Map<string, VerificationDocumentRow>();
  readonly admins = new Map<string, AdminAccountRow>();
  readonly adminSessions = new Map<string, AdminSessionRow>();
  readonly auditLogs: Array<{ action: string; entityId: string }> = [];
  readonly loginLogs: Array<{ success: boolean; username: string }> = [];
  readonly selected = new Map<string, Set<string>>();
  readonly specializations: SpecializationRow[] = ['civil', 'family', 'labor'].map((code) => ({
    active: true,
    code,
    created_at: new Date().toISOString(),
    id: randomUUID(),
    name_en: `${code} law`,
    name_ru: `${code} право`,
    name_uz: `${code} huquqi`,
  }));

  constructor(private readonly core: MemoryCoreRepository) {}

  findProfileByUserId(userId: string): Promise<LawyerProfileRecord | null> {
    const profile = [...this.profiles.values()].find((item) => item.user_id === userId);
    return Promise.resolve(profile ? this.record(profile) : null);
  }

  findApprovedProfileByDuid(duid: string): Promise<LawyerProfileRecord | null> {
    const profile = [...this.profiles.values()].find(
      (item) => item.public_slug === duid && item.verification_status === 'approved',
    );
    return Promise.resolve(profile ? this.record(profile) : null);
  }

  createProfile(userId: string, publicSlug: string): Promise<LawyerProfileRecord> {
    const existing = [...this.profiles.values()].find((item) => item.user_id === userId);
    if (existing) return Promise.resolve(this.record(existing));
    if ([...this.profiles.values()].some((item) => item.public_slug === publicSlug))
      throw new Error('duplicate public slug');
    const now = new Date().toISOString();
    const profile: LawyerProfileRow = {
      bio: null,
      consultation_price: null,
      created_at: now,
      experience_years: null,
      id: randomUUID(),
      jobs_count: 0,
      profile_image_path: null,
      public_slug: publicSlug,
      rating_average: 0,
      rating_count: 0,
      region: null,
      updated_at: now,
      user_id: userId,
      verification_status: 'unverified',
      verified_at: null,
    };
    this.profiles.set(profile.id, profile);
    return Promise.resolve(this.record(profile));
  }

  listSpecializations(): Promise<SpecializationRow[]> {
    return Promise.resolve(this.specializations.filter((item) => item.active));
  }
  findSpecializationsByCodes(codes: string[]): Promise<SpecializationRow[]> {
    return Promise.resolve(
      this.specializations.filter((item) => item.active && codes.includes(item.code)),
    );
  }

  searchApproved(input: LawyerSearchInput) {
    let items = [...this.profiles.values()].filter(
      (item) => item.verification_status === 'approved',
    );
    if (input.region) items = items.filter((item) => item.region === input.region);
    if (input.minExperience !== undefined)
      items = items.filter((item) => (item.experience_years ?? -1) >= input.minExperience!);
    if (input.specialization)
      items = items.filter((item) => this.selected.get(item.id)?.has(input.specialization!));
    const field =
      input.sort === 'experience'
        ? 'experience_years'
        : input.sort === 'newest'
          ? 'verified_at'
          : 'rating_average';
    items.sort((a, b) => String(b[field] ?? '').localeCompare(String(a[field] ?? '')));
    const total = items.length;
    const start = (input.page - 1) * input.limit;
    return Promise.resolve({
      items: items.slice(start, start + input.limit).map((item) => this.record(item)),
      total,
    });
  }

  findLatestVerification(lawyerId: string): Promise<LawyerVerificationRow | null> {
    return Promise.resolve(
      [...this.verifications.values()]
        .filter((item) => item.lawyer_id === lawyerId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
    );
  }
  findOpenVerification(lawyerId: string): Promise<LawyerVerificationRow | null> {
    return Promise.resolve(
      [...this.verifications.values()].find(
        (item) =>
          item.lawyer_id === lawyerId &&
          ['draft', 'submitted', 'pending_review'].includes(item.status),
      ) ?? null,
    );
  }
  findVerificationById(id: string): Promise<LawyerVerificationRow | null> {
    return Promise.resolve(this.verifications.get(id) ?? null);
  }

  createVerification(input: {
    lawyerId: string;
    type: 'initial' | 'profile_update';
    submittedData: Json;
    status?: 'draft' | 'pending_review';
    now: Date;
  }): Promise<LawyerVerificationRow> {
    if (
      [...this.verifications.values()].some(
        (item) =>
          item.lawyer_id === input.lawyerId &&
          ['draft', 'submitted', 'pending_review'].includes(item.status),
      )
    )
      throw new Error('duplicate pending');
    const now = input.now.toISOString();
    const row: LawyerVerificationRow = {
      created_at: now,
      id: randomUUID(),
      lawyer_id: input.lawyerId,
      reject_reason: null,
      reviewed_at: null,
      reviewed_by: null,
      status: input.status ?? 'draft',
      submitted_at: input.status === 'pending_review' ? now : null,
      submitted_data: input.submittedData,
      type: input.type,
      updated_at: now,
    };
    this.verifications.set(row.id, row);
    if (input.type === 'initial') {
      const profile = this.profiles.get(input.lawyerId)!;
      this.profiles.set(profile.id, {
        ...profile,
        verification_status: input.status === 'pending_review' ? 'pending_review' : 'draft',
      });
    }
    return Promise.resolve(row);
  }

  updateDraft(id: string, submittedData: Json): Promise<LawyerVerificationRow> {
    const row = this.verifications.get(id);
    if (!row || row.status !== 'draft') throw new Error('draft missing');
    const updated = { ...row, submitted_data: submittedData, updated_at: new Date().toISOString() };
    this.verifications.set(id, updated);
    return Promise.resolve(updated);
  }
  submitDraft(id: string, submittedData: Json, now: Date): Promise<LawyerVerificationRow | null> {
    const row = this.verifications.get(id);
    if (!row || row.status !== 'draft') return Promise.resolve(null);
    const updated = {
      ...row,
      status: 'pending_review',
      submitted_at: now.toISOString(),
      submitted_data: submittedData,
      updated_at: now.toISOString(),
    };
    this.verifications.set(id, updated);
    if (row.type === 'initial') {
      const profile = this.profiles.get(row.lawyer_id)!;
      this.profiles.set(profile.id, { ...profile, verification_status: 'pending_review' });
    }
    return Promise.resolve(updated);
  }
  cancelDraft(id: string): Promise<void> {
    const draft = this.verifications.get(id);
    if (draft?.status !== 'draft') return Promise.resolve();
    this.verifications.delete(id);
    if (draft.type === 'initial') {
      const profile = this.profiles.get(draft.lawyer_id);
      if (profile) {
        const previous = [...this.verifications.values()]
          .filter((item) => item.lawyer_id === draft.lawyer_id && item.type === 'initial')
          .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
        const verificationStatus =
          previous?.status === 'approved'
            ? 'approved'
            : previous?.status === 'rejected'
              ? 'rejected'
              : previous?.status === 'submitted' || previous?.status === 'pending_review'
                ? 'pending_review'
                : previous?.status === 'draft'
                  ? 'draft'
                  : 'unverified';
        this.profiles.set(profile.id, { ...profile, verification_status: verificationStatus });
      }
    }
    return Promise.resolve();
  }

  addVerificationDocument(input: FileUploadInput): Promise<VerificationDocumentRow> {
    const row: VerificationDocumentRow = {
      created_at: new Date().toISOString(),
      id: randomUUID(),
      kind: input.kind,
      mime_type: input.contentType,
      original_filename: input.originalFilename,
      size_bytes: input.bytes.byteLength,
      storage_bucket: input.kind === 'profile_image' ? 'profile-images' : 'lawyer-verification',
      storage_path: input.storagePath,
      verification_id: input.verificationId,
    };
    this.documents.set(row.id, row);
    return Promise.resolve(row);
  }
  listVerificationDocuments(id: string): Promise<VerificationDocumentRow[]> {
    return Promise.resolve(
      [...this.documents.values()].filter((item) => item.verification_id === id),
    );
  }
  createSignedUrl(bucket: string, path: string): Promise<string> {
    return Promise.resolve(`https://signed.invalid/${bucket}/${path}`);
  }

  findAdminByUsername(username: string): Promise<AdminAccountRow | null> {
    return Promise.resolve(
      [...this.admins.values()].find((item) => item.username === username) ?? null,
    );
  }
  findAdminById(id: string): Promise<AdminAccountRow | null> {
    return Promise.resolve(this.admins.get(id) ?? null);
  }
  createAdmin(username: string, passwordHash: string): Promise<AdminAccountRow> {
    const now = new Date().toISOString();
    const row: AdminAccountRow = {
      created_at: now,
      failed_login_attempts: 0,
      id: randomUUID(),
      last_login_at: null,
      locked_until: null,
      password_hash: passwordHash,
      role: 'admin',
      status: 'active',
      updated_at: now,
      username,
    };
    this.admins.set(row.id, row);
    return Promise.resolve(row);
  }
  updateAdminLoginState(id: string, update: Partial<AdminAccountRow>): Promise<AdminAccountRow> {
    const row = this.admins.get(id);
    if (!row) throw new Error('admin missing');
    const updated = { ...row, ...update, updated_at: new Date().toISOString() };
    this.admins.set(id, updated);
    return Promise.resolve(updated);
  }
  createAdminSession(input: {
    adminId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
  }): Promise<AdminSessionRow> {
    const row: AdminSessionRow = {
      admin_id: input.adminId,
      created_at: input.now.toISOString(),
      expires_at: input.expiresAt.toISOString(),
      id: randomUUID(),
      last_seen_at: input.now.toISOString(),
      revoked_at: null,
      token_hash: input.tokenHash,
    };
    this.adminSessions.set(row.id, row);
    return Promise.resolve(row);
  }
  findAdminSessionByTokenHash(hash: string): Promise<AdminSessionRow | null> {
    return Promise.resolve(
      [...this.adminSessions.values()].find((item) => item.token_hash === hash) ?? null,
    );
  }
  touchAdminSession(id: string, now: Date): Promise<void> {
    const row = this.adminSessions.get(id);
    if (row) this.adminSessions.set(id, { ...row, last_seen_at: now.toISOString() });
    return Promise.resolve();
  }
  revokeAdminSession(id: string, now: Date): Promise<void> {
    const row = this.adminSessions.get(id);
    if (row) this.adminSessions.set(id, { ...row, revoked_at: now.toISOString() });
    return Promise.resolve();
  }
  logAdminLogin(input: { username: string; success: boolean }): Promise<void> {
    this.loginLogs.push({ success: input.success, username: input.username });
    return Promise.resolve();
  }

  async listVerifications(
    input: VerificationListInput,
  ): Promise<{ items: VerificationRecord[]; total: number }> {
    let rows = [...this.verifications.values()];
    if (input.status) rows = rows.filter((item) => item.status === input.status);
    const total = rows.length;
    const start = (input.page - 1) * input.limit;
    return {
      items: await Promise.all(
        rows.slice(start, start + input.limit).map((item) => this.hydrate(item)),
      ),
      total,
    };
  }
  async getVerificationDetail(id: string): Promise<VerificationRecord | null> {
    const row = this.verifications.get(id);
    return row ? this.hydrate(row) : null;
  }

  reviewVerification(input: {
    verificationId: string;
    adminId: string;
    decision: 'approved' | 'rejected';
    rejectReason: string | null;
  }): Promise<'reviewed' | 'not_found' | 'conflict'> {
    const row = this.verifications.get(input.verificationId);
    if (!row) return Promise.resolve('not_found');
    if (!['submitted', 'pending_review'].includes(row.status)) return Promise.resolve('conflict');
    const reviewedAt = new Date().toISOString();
    this.verifications.set(row.id, {
      ...row,
      reject_reason: input.decision === 'rejected' ? input.rejectReason : null,
      reviewed_at: reviewedAt,
      reviewed_by: input.adminId,
      status: input.decision,
    });
    const profile = this.profiles.get(row.lawyer_id)!;
    if (input.decision === 'approved') {
      const data = row.submitted_data as Record<string, unknown>;
      this.profiles.set(profile.id, {
        ...profile,
        bio: String(data.bio),
        consultation_price:
          typeof data.consultationPrice === 'number' ? data.consultationPrice : null,
        experience_years: Number(data.experienceYears),
        profile_image_path: String(data.profileImagePath),
        region: String(data.region),
        verification_status: 'approved',
        verified_at: reviewedAt,
      });
      this.selected.set(profile.id, new Set(data.specializationCodes as string[]));
      this.core.approvedLawyerUserIds.add(profile.user_id);
      const user = this.core.users.get(profile.user_id)!;
      this.core.users.set(user.id, {
        ...user,
        full_name: String(data.fullName),
        onboarding_role: 'lawyer',
      });
    } else if (row.type === 'initial')
      this.profiles.set(profile.id, { ...profile, verification_status: 'rejected' });
    this.auditLogs.push({ action: `lawyer_verification.${input.decision}`, entityId: row.id });
    return Promise.resolve('reviewed');
  }

  private record(profile: LawyerProfileRow): LawyerProfileRecord {
    const user = this.core.users.get(profile.user_id);
    if (!user) throw new Error('user missing');
    const selected = this.selected.get(profile.id) ?? new Set<string>();
    return {
      profile,
      specializations: this.specializations.filter((item) => selected.has(item.code)),
      user,
    };
  }
  private async hydrate(verification: LawyerVerificationRow): Promise<VerificationRecord> {
    return {
      documents: await this.listVerificationDocuments(verification.id),
      profile: this.record(this.profiles.get(verification.lawyer_id)!),
      verification,
    };
  }
}
