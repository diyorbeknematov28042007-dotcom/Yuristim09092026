import { createHash, randomUUID } from 'node:crypto';
import {
  ContributionRepositoryError,
  type ContributionMime,
  type ContributionPageInput,
  type DocumentContributionRepository,
  type DocumentContributionRow,
} from '@yuristim/db';
import { AppError } from '../../lib/errors.js';
export type UploadInput = {
  documentType: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  privacyAcknowledged: boolean;
  rightsConfirmed: boolean;
};
const PDF = 'application/pdf',
  DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TYPES = [
  'nikoh-shartnomasi',
  'davo-arizasi',
  'ijara-shartnomasi',
  'ishonchnoma',
  'talabnoma',
];
function unsupported(): never {
  throw new AppError(
    415,
    'DOCUMENT_UNSUPPORTED_FILE',
    'Only valid PDF and DOCX files are supported',
  );
}
function hasControl(value: string) {
  return [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}
export function validateUploadMetadata(input: UploadInput): 'pdf' | 'docx' {
  if (
    !TYPES.includes(input.documentType) ||
    !input.privacyAcknowledged ||
    !input.rightsConfirmed ||
    !Number.isSafeInteger(input.fileSizeBytes) ||
    input.fileSizeBytes < 1 ||
    !input.originalFilename.trim() ||
    input.originalFilename.length > 200 ||
    /[/\\\u202a-\u202e\u2066-\u2069]/u.test(input.originalFilename) ||
    hasControl(input.originalFilename)
  )
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid contribution metadata or confirmations');
  if (input.fileSizeBytes > 5242880)
    throw new AppError(413, 'DOCUMENT_FILE_TOO_LARGE', 'File must be at most 5 MB');
  const ext = input.originalFilename.toLowerCase().split('.').at(-1);
  if ((ext === 'pdf' && input.mimeType === PDF) || (ext === 'docx' && input.mimeType === DOCX))
    return ext;
  return unsupported();
}
// Inspect container signatures and directory metadata only; never extract document content.
export function validateDocumentBytes(input: UploadInput, bytes: Uint8Array, mime: string): void {
  const ext = validateUploadMetadata(input),
    b = Buffer.from(bytes);
  if (b.length > 5242880)
    throw new AppError(413, 'DOCUMENT_FILE_TOO_LARGE', 'File must be at most 5 MB');
  if (b.length !== input.fileSizeBytes || mime.split(';')[0] !== input.mimeType) unsupported();
  if (ext === 'pdf') {
    if (
      !/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(b.subarray(0, 8).toString('ascii')) ||
      !b.subarray(Math.max(0, b.length - 2048)).includes(Buffer.from('%%EOF'))
    )
      unsupported();
    return;
  }
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) unsupported();
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (
    end < 0 ||
    b.readUInt16LE(end + 4) !== 0 ||
    b.readUInt16LE(end + 6) !== 0 ||
    end + 22 + b.readUInt16LE(end + 20) !== b.length
  )
    unsupported();
  const count = b.readUInt16LE(end + 10),
    start = b.readUInt32LE(end + 16),
    size = b.readUInt32LE(end + 12);
  if (!count || count > 2048 || b.readUInt16LE(end + 8) !== count || start + size !== end)
    unsupported();
  let p = start;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || b.readUInt32LE(p) !== 0x02014b50) unsupported();
    const flags = b.readUInt16LE(p + 8),
      method = b.readUInt16LE(p + 10),
      n = b.readUInt16LE(p + 28),
      extra = b.readUInt16LE(p + 30),
      comment = b.readUInt16LE(p + 32),
      local = b.readUInt32LE(p + 42),
      compressed = b.readUInt32LE(p + 20);
    if (
      p + 46 + n + extra + comment > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      b.readUInt16LE(p + 34) !== 0 ||
      local + 30 > start
    )
      unsupported();
    const name = b.subarray(p + 46, p + 46 + n).toString('utf8');
    if (
      !name ||
      names.has(name) ||
      name.includes(String.fromCharCode(92)) ||
      hasControl(name) ||
      name.startsWith('/') ||
      name.split('/').includes('..') ||
      /(^|\/)(vbaProject\.bin|activeX|embeddings)(\/|$)|\.(exe|dll|js|vbs|bat|cmd)$/i.test(name) ||
      b.readUInt32LE(local) !== 0x04034b50
    )
      unsupported();
    const localN = b.readUInt16LE(local + 26),
      localExtra = b.readUInt16LE(local + 28);
    if (
      local + 30 + localN + localExtra + compressed > start ||
      b.subarray(local + 30, local + 30 + localN).toString('utf8') !== name ||
      b.readUInt16LE(local + 6) & 1
    )
      unsupported();
    names.add(name);
    p += 46 + n + extra + comment;
  }
  if (p !== end || !names.has('[Content_Types].xml') || !names.has('word/document.xml'))
    unsupported();
}
export function contributionView(row: DocumentContributionRow) {
  return {
    id: row.id,
    publicId: row.public_id,
    documentType: row.document_type,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}
export class DocumentContributionService {
  constructor(private readonly repository: DocumentContributionRepository) {}
  private async operation<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof ContributionRepositoryError) {
        switch (e.code) {
          case 'P0002':
            throw new AppError(404, 'NOT_FOUND', 'Contribution not found');
          case '42501':
            throw new AppError(403, 'FORBIDDEN', 'Review access is required');
          case '40001':
            throw new AppError(
              409,
              'DOCUMENT_CONFLICT',
              'Contribution state changed or upload expired',
            );
          case '23514':
            return unsupported();
          case 'FILE_NOT_READY':
            throw new AppError(409, 'DOCUMENT_FILE_NOT_READY', 'Upload the file before submitting');
          case 'FILE_TOO_LARGE':
            throw new AppError(413, 'DOCUMENT_FILE_TOO_LARGE', 'File must be at most 5 MB');
        }
      }
      throw new AppError(
        503,
        'DOCUMENT_STORAGE_UNAVAILABLE',
        'Document service is temporarily unavailable',
      );
    }
  }
  private async own(id: string, userId: string) {
    const row = await this.repository.findById(id);
    if (!row || row.user_id !== userId)
      throw new AppError(404, 'NOT_FOUND', 'Contribution not found');
    return row;
  }
  async initiate(userId: string, input: UploadInput, key: string) {
    return this.operation(async () => {
      const ext = validateUploadMetadata(input);
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            input.documentType,
            input.originalFilename,
            input.mimeType,
            input.fileSizeBytes,
            input.privacyAcknowledged,
            input.rightsConfirmed,
          ]),
        )
        .digest('hex');
      const row = await this.repository.createDraft({
        user_id: userId,
        document_type: input.documentType,
        original_filename: input.originalFilename,
        mime_type: input.mimeType as ContributionMime,
        file_size_bytes: input.fileSizeBytes,
        storage_path: `${userId}/${randomUUID()}/source.${ext}`,
        privacy_acknowledged: true,
        rights_confirmed: true,
        idempotency_key: key,
        upload_fingerprint: fingerprint,
      });
      if (row.upload_fingerprint !== fingerprint)
        throw new AppError(409, 'DOCUMENT_CONFLICT', 'Idempotency key belongs to different input');
      if (row.status !== 'draft') return { contribution: contributionView(row), upload: null };
      if (new Date(row.upload_expires_at) <= new Date())
        throw new AppError(409, 'DOCUMENT_UPLOAD_EXPIRED', 'Upload expired; select the file again');
      return {
        contribution: contributionView(row),
        upload: {
          url: await this.repository.signedUpload(row.storage_path),
          expiresAt: row.upload_expires_at,
        },
      };
    });
  }
  async submit(id: string, userId: string) {
    return this.operation(async () => {
      const row = await this.own(id, userId);
      if (row.status !== 'draft') return contributionView(row);
      if (new Date(row.upload_expires_at) <= new Date())
        throw new AppError(409, 'DOCUMENT_UPLOAD_EXPIRED', 'Upload expired; select the file again');
      const file = await this.repository.readFile(row.storage_path);
      try {
        validateDocumentBytes(
          {
            documentType: row.document_type,
            originalFilename: row.original_filename,
            mimeType: row.mime_type,
            fileSizeBytes: row.file_size_bytes,
            privacyAcknowledged: row.privacy_acknowledged,
            rightsConfirmed: row.rights_confirmed,
          },
          file.bytes,
          file.mime,
        );
      } catch (e) {
        await this.repository.removeFile(row.storage_path);
        throw e;
      }
      return contributionView(
        await this.repository.submit(
          id,
          userId,
          createHash('sha256').update(file.bytes).digest('hex'),
        ),
      );
    });
  }
  async list(input: ContributionPageInput, userId?: string) {
    return this.operation(async () => {
      const result = await this.repository.list(input, userId);
      return {
        items: result.items.map(contributionView),
        total: result.total,
        page: input.page,
        limit: input.limit,
      };
    });
  }
  async detail(id: string, userId?: string) {
    return this.operation(async () => {
      const row = userId ? await this.own(id, userId) : await this.repository.findById(id);
      if (!row || (!userId && row.status === 'draft'))
        throw new AppError(404, 'NOT_FOUND', 'Contribution not found');
      return contributionView(row);
    });
  }
  async file(id: string, userId?: string) {
    return this.operation(async () => {
      const row = userId ? await this.own(id, userId) : await this.repository.findById(id);
      if (!row || row.status === 'draft')
        throw new AppError(404, 'NOT_FOUND', 'Contribution not found');
      return {
        url: await this.repository.signedDownload(row.storage_path, row.original_filename, 300),
        expiresInSeconds: 300,
      };
    });
  }
  async review(
    id: string,
    adminId: string,
    decision: 'under_review' | 'approved' | 'rejected',
    reason: string | null,
  ) {
    return this.operation(async () =>
      contributionView(await this.repository.review(id, adminId, decision, reason)),
    );
  }
  async cleanupExpiredDrafts(now = new Date()) {
    return this.operation(async () => {
      const rows = await this.repository.expiredDrafts(
        new Date(now.getTime() - 2 * 60 * 60 * 1000),
        100,
      );
      for (const row of rows) {
        await this.repository.removeFile(row.storage_path);
        await this.repository.removeDraft(row.id);
      }
      return rows.length;
    });
  }
}
