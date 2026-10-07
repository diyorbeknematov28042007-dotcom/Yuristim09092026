export type ContributionStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected';
export type ContributionMime =
  'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export type DocumentContributionRow = {
  id: string;
  public_id: string;
  user_id: string;
  document_type: string;
  original_filename: string;
  mime_type: ContributionMime;
  file_size_bytes: number;
  storage_path: string;
  status: ContributionStatus;
  privacy_acknowledged: boolean;
  rights_confirmed: boolean;
  idempotency_key: string;
  upload_fingerprint: string;
  file_sha256: string | null;
  upload_expires_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};
export type ContributionInsert = Pick<
  DocumentContributionRow,
  | 'user_id'
  | 'document_type'
  | 'original_filename'
  | 'mime_type'
  | 'file_size_bytes'
  | 'storage_path'
  | 'privacy_acknowledged'
  | 'rights_confirmed'
  | 'idempotency_key'
  | 'upload_fingerprint'
>;
export type ContributionPageInput = {
  page: number;
  limit: number;
  status?: Exclude<ContributionStatus, 'draft'> | undefined;
};
export class ContributionRepositoryError extends Error {
  constructor(readonly code: string) {
    super('Document repository operation failed');
  }
}
export interface DocumentContributionRepository {
  findByKey(userId: string, key: string): Promise<DocumentContributionRow | null>;
  findById(id: string): Promise<DocumentContributionRow | null>;
  createDraft(input: ContributionInsert): Promise<DocumentContributionRow>;
  list(
    input: ContributionPageInput,
    userId?: string,
  ): Promise<{ items: DocumentContributionRow[]; total: number }>;
  signedUpload(path: string): Promise<string>;
  readFile(path: string): Promise<{ bytes: Uint8Array; mime: string }>;
  signedDownload(path: string, filename: string, seconds: number): Promise<string>;
  submit(id: string, userId: string, hash: string): Promise<DocumentContributionRow>;
  review(
    id: string,
    adminId: string,
    decision: 'under_review' | 'approved' | 'rejected',
    reason: string | null,
  ): Promise<DocumentContributionRow>;
  expiredDrafts(before: Date, limit: number): Promise<DocumentContributionRow[]>;
  removeDraft(id: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}
