import { randomUUID } from 'node:crypto';
import {
  ContributionRepositoryError,
  type ContributionInsert,
  type ContributionPageInput,
  type DocumentContributionRepository,
  type DocumentContributionRow,
} from '@yuristim/db';
export class MemoryDocumentContributionRepository implements DocumentContributionRepository {
  readonly rows = new Map<string, DocumentContributionRow>();
  readonly files = new Map<string, { bytes: Uint8Array; mime: string }>();
  readonly audit: Array<{ actorId: string; entityId: string; action: string }> = [];
  failSignedUpload = false;
  failSubmit = false;
  async findByKey(userId: string, key: string) {
    return (
      [...this.rows.values()].find((r) => r.user_id === userId && r.idempotency_key === key) ?? null
    );
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async createDraft(input: ContributionInsert) {
    const existing = await this.findByKey(input.user_id, input.idempotency_key);
    if (existing) return existing;
    const now = new Date();
    const id = randomUUID();
    const row: DocumentContributionRow = {
      ...input,
      id,
      public_id: `DLC-${id.replaceAll('-', '')}`,
      status: 'draft',
      file_sha256: null,
      upload_expires_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      submitted_at: null,
      reviewed_at: null,
      reviewed_by: null,
      rejection_reason: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    this.rows.set(id, row);
    return row;
  }
  async list(input: ContributionPageInput, userId?: string) {
    const items = [...this.rows.values()].filter(
      (r) =>
        r.status !== 'draft' &&
        (!userId || r.user_id === userId) &&
        (!input.status || r.status === input.status),
    );
    return {
      items: items.slice((input.page - 1) * input.limit, input.page * input.limit),
      total: items.length,
    };
  }
  async signedUpload(path: string) {
    if (this.failSignedUpload) throw new ContributionRepositoryError('STORAGE_UNAVAILABLE');
    return `https://storage.example/upload/${path}?token=scoped`;
  }
  async readFile(path: string) {
    const data = this.files.get(path);
    if (!data) throw new ContributionRepositoryError('FILE_NOT_READY');
    return data;
  }
  async signedDownload(path: string, _filename: string, seconds: number) {
    return `https://storage.example/download/${path}?expires=${seconds}`;
  }
  async submit(id: string, userId: string, hash: string) {
    if (this.failSubmit) throw new ContributionRepositoryError('UNAVAILABLE');
    const row = this.rows.get(id);
    if (!row || row.user_id !== userId) throw new ContributionRepositoryError('P0002');
    if (row.status !== 'draft') return row;
    if (new Date(row.upload_expires_at) <= new Date())
      throw new ContributionRepositoryError('40001');
    const updated: DocumentContributionRow = {
      ...row,
      status: 'submitted',
      file_sha256: hash,
      submitted_at: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return updated;
  }
  async review(
    id: string,
    adminId: string,
    decision: 'under_review' | 'approved' | 'rejected',
    reason: string | null,
  ) {
    const row = this.rows.get(id);
    if (!row) throw new ContributionRepositoryError('P0002');
    if (
      !['submitted', 'under_review'].includes(row.status) ||
      (decision === 'under_review' && row.status !== 'submitted')
    )
      throw new ContributionRepositoryError('40001');
    const updated: DocumentContributionRow = {
      ...row,
      status: decision,
      reviewed_at: decision === 'under_review' ? null : new Date().toISOString(),
      reviewed_by: decision === 'under_review' ? null : adminId,
      rejection_reason: decision === 'rejected' ? reason : null,
    };
    this.rows.set(id, updated);
    this.audit.push({ actorId: adminId, entityId: id, action: decision });
    return updated;
  }
  async expiredDrafts(now: Date, limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.status === 'draft' && new Date(r.upload_expires_at) < now)
      .slice(0, limit);
  }
  async removeDraft(id: string) {
    if (this.rows.get(id)?.status === 'draft') this.rows.delete(id);
  }
  async removeFile(path: string) {
    this.files.delete(path);
  }
}
