import { D1AdminRepository, type D1AdminBinding } from './d1-admin-repository.js';
import {
  D1LawyerFileRepository,
  type D1LawyerFileBinding,
  type PrivateR2Bucket,
} from './d1-lawyer-file-repository.js';
import {
  D1LawyerProfileRepository,
  fromD1LawyerVerification,
  type D1LawyerProfileBinding,
  type D1RawLawyerProfile,
  type D1RawLawyerVerification,
} from './d1-lawyer-profile-repository.js';
import {
  D1LawyerReviewRepository,
  type D1LawyerReviewBinding,
} from './d1-lawyer-review-repository.js';
import type {
  LawyerRepository,
  VerificationDocumentRow,
  VerificationListInput,
  VerificationRecord,
} from './lawyer-repository.js';

export type D1LawyerBinding = D1AdminBinding &
  D1LawyerFileBinding &
  D1LawyerProfileBinding &
  D1LawyerReviewBinding;

/** The complete existing LawyerRepository contract backed by D1 and private R2. */
export class D1LawyerRepository extends D1LawyerProfileRepository implements LawyerRepository {
  private readonly admins: D1AdminRepository;
  private readonly files: D1LawyerFileRepository;
  private readonly reviews: D1LawyerReviewRepository;
  constructor(
    private readonly lawyerDb: D1LawyerBinding,
    bucket: PrivateR2Bucket,
    publicApiUrl: string,
    signingSecret: string,
    now: () => Date = () => new Date(),
  ) {
    super(lawyerDb);
    this.admins = new D1AdminRepository(lawyerDb);
    this.files = new D1LawyerFileRepository(lawyerDb, bucket, publicApiUrl, signingSecret, now);
    this.reviews = new D1LawyerReviewRepository(lawyerDb, now);
  }

  addVerificationDocument(input: Parameters<LawyerRepository['addVerificationDocument']>[0]) {
    return this.files.addVerificationDocument(input);
  }
  listVerificationDocuments(id: string) {
    return this.files.listVerificationDocuments(id);
  }
  createSignedUrl(bucket: string, path: string, ttl: number) {
    return this.files.createSignedUrl(bucket, path, ttl);
  }
  serveSignedFile(request: Request): Promise<Response> {
    return this.files.serveSignedFile(request);
  }

  findAdminByUsername(username: string) {
    return this.admins.findAdminByUsername(username);
  }
  findAdminById(id: string) {
    return this.admins.findAdminById(id);
  }
  createAdmin(username: string, hash: string) {
    return this.admins.createAdmin(username, hash);
  }
  updateAdminLoginState(
    id: string,
    update: Parameters<LawyerRepository['updateAdminLoginState']>[1],
  ) {
    return this.admins.updateAdminLoginState(id, update);
  }
  createAdminSession(input: Parameters<LawyerRepository['createAdminSession']>[0]) {
    return this.admins.createAdminSession(input);
  }
  findAdminSessionByTokenHash(hash: string) {
    return this.admins.findAdminSessionByTokenHash(hash);
  }
  touchAdminSession(id: string, now: Date) {
    return this.admins.touchAdminSession(id, now);
  }
  revokeAdminSession(id: string, now: Date) {
    return this.admins.revokeAdminSession(id, now);
  }
  logAdminLogin(input: Parameters<LawyerRepository['logAdminLogin']>[0]) {
    return this.admins.logAdminLogin(input);
  }
  getAdminUserStats(now: Date) {
    return this.admins.getAdminUserStats(now);
  }
  reviewVerification(input: Parameters<LawyerRepository['reviewVerification']>[0]) {
    return this.reviews.reviewVerification(input);
  }

  private async hydrateVerifications(
    rows: D1RawLawyerVerification[],
  ): Promise<VerificationRecord[]> {
    if (!rows.length) return [];
    const lawyerIds = [...new Set(rows.map((row) => row.lawyer_id))];
    const [profiles, documents] = await Promise.all([
      this.lawyerDb
        .prepare(
          `SELECT * FROM lawyer_profiles WHERE id IN (${lawyerIds.map(() => '?').join(',')})`,
        )
        .bind(...lawyerIds)
        .all<D1RawLawyerProfile>(),
      this.lawyerDb
        .prepare(
          `SELECT * FROM verification_documents WHERE verification_id IN (${rows.map(() => '?').join(',')}) ORDER BY created_at,id`,
        )
        .bind(...rows.map((row) => row.id))
        .all<VerificationDocumentRow>(),
    ]);
    const byLawyer = new Map(
      (await this.hydrateMany(profiles.results)).map((row) => [row.profile.id, row]),
    );
    const byVerification = new Map<string, VerificationDocumentRow[]>();
    for (const document of documents.results) {
      const entries = byVerification.get(document.verification_id) ?? [];
      entries.push(document);
      byVerification.set(document.verification_id, entries);
    }
    return rows.map((row) => {
      const linked = byLawyer.get(row.lawyer_id);
      if (!linked) throw new Error('Lawyer verification has no profile');
      return {
        verification: fromD1LawyerVerification(row),
        profile: linked,
        documents: byVerification.get(row.id) ?? [],
      };
    });
  }
  async listVerifications(
    input: VerificationListInput,
  ): Promise<{ items: VerificationRecord[]; total: number }> {
    if (
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.status &&
        !['draft', 'submitted', 'pending_review', 'approved', 'rejected'].includes(input.status)) ||
      !Number.isSafeInteger((input.page - 1) * input.limit)
    )
      throw new Error('Invalid verification list');
    const clause = input.status ? ' WHERE status=?' : '';
    const args = input.status ? [input.status] : [];
    const [count, page] = await Promise.all([
      this.lawyerDb
        .prepare(`SELECT count(*) AS total FROM lawyer_verifications${clause}`)
        .bind(...args)
        .first<{ total: number }>(),
      this.lawyerDb
        .prepare(
          `SELECT * FROM lawyer_verifications${clause} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
        )
        .bind(...args, input.limit, (input.page - 1) * input.limit)
        .all<D1RawLawyerVerification>(),
    ]);
    return { items: await this.hydrateVerifications(page.results), total: count?.total ?? 0 };
  }
  async getVerificationDetail(id: string): Promise<VerificationRecord | null> {
    const row = await this.lawyerDb
      .prepare('SELECT * FROM lawyer_verifications WHERE id=?')
      .bind(id)
      .first<D1RawLawyerVerification>();
    return row ? (await this.hydrateVerifications([row]))[0]! : null;
  }
}
