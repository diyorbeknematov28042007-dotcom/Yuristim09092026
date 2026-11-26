import type {
  FileUploadInput,
  LawyerRepository,
  VerificationDocumentRow,
} from './lawyer-repository.js';

type Value = string | number | null;
interface Statement {
  bind(...values: Value[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface D1LawyerFileBinding {
  prepare(sql: string): Statement;
}
export interface PrivateR2Bucket {
  put(
    key: string,
    bytes: Uint8Array,
    options: { onlyIf: { etagDoesNotMatch: '*' }; httpMetadata: { contentType: string } },
  ): Promise<object | null>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
  delete(key: string): Promise<void>;
}

const buckets = new Set(['profile-images', 'lawyer-verification']);
const encoder = new TextEncoder();
async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function sameHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  let different = 0;
  for (let index = 0; index < 64; index++)
    different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}
function objectKey(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

/** A private bucket: callers must authorize before requesting a signed URL. */
export class D1LawyerFileRepository implements Pick<
  LawyerRepository,
  'addVerificationDocument' | 'listVerificationDocuments' | 'createSignedUrl'
> {
  constructor(
    private readonly db: D1LawyerFileBinding,
    private readonly r2: PrivateR2Bucket,
    private readonly publicApiUrl: string,
    private readonly signingSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (encoder.encode(signingSecret).length < 32) throw new Error('Weak file signing secret');
  }

  async addVerificationDocument(input: FileUploadInput): Promise<VerificationDocumentRow> {
    const bucket = input.kind === 'profile_image' ? 'profile-images' : 'lawyer-verification';
    const row = await this.db
      .prepare(
        `SELECT l.id FROM lawyer_verifications v
      JOIN lawyer_profiles l ON l.id=v.lawyer_id
      WHERE v.id=? AND v.status='draft'`,
      )
      .bind(input.verificationId)
      .first<{ id: string }>();
    if (
      !row ||
      !input.storagePath.startsWith(`${row.id}/${input.verificationId}/`) ||
      !/^[0-9a-f-]{36}\.(?:pdf|png|jpg)$/.test(input.storagePath.split('/').at(-1) ?? '') ||
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > 5 * 1024 * 1024 ||
      (input.kind === 'profile_image' && input.contentType === 'application/pdf')
    )
      throw new Error('Invalid verification upload');
    const key = objectKey(bucket, input.storagePath);
    const stored = await this.r2.put(key, input.bytes, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: input.contentType },
    });
    if (!stored) throw new Error('Verification object already exists');
    try {
      const document = await this.db
        .prepare(
          `INSERT INTO verification_documents
        (id,verification_id,kind,storage_bucket,storage_path,original_filename,mime_type,size_bytes)
        SELECT ?,v.id,?,?,?,?,?,? FROM lawyer_verifications v
        WHERE v.id=? AND v.status='draft' RETURNING *`,
        )
        .bind(
          crypto.randomUUID(),
          input.kind,
          bucket,
          input.storagePath,
          input.originalFilename,
          input.contentType,
          input.bytes.byteLength,
          input.verificationId,
        )
        .first<VerificationDocumentRow>();
      if (!document) throw new Error('Verification draft is closed');
      return document;
    } catch (error) {
      await this.r2.delete(key).catch(() => {
        // A failed cleanup leaves an unreferenced private object, never a public leak.
      });
      throw error;
    }
  }
  async listVerificationDocuments(verificationId: string): Promise<VerificationDocumentRow[]> {
    const rows = await this.db
      .prepare(
        'SELECT * FROM verification_documents WHERE verification_id=? ORDER BY created_at,id',
      )
      .bind(verificationId)
      .all<VerificationDocumentRow>();
    return rows.results;
  }
  async createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string> {
    if (
      !buckets.has(bucket) ||
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > 900
    )
      throw new Error('Invalid file capability');
    const exists = await this.db
      .prepare('SELECT id FROM verification_documents WHERE storage_bucket=? AND storage_path=?')
      .bind(bucket, path)
      .first<{ id: string }>();
    if (!exists) throw new Error('Verification file not found');
    const expires = Math.floor(this.now().getTime() / 1000) + expiresInSeconds;
    const url = new URL('/private/lawyer-file', this.publicApiUrl);
    url.searchParams.set('bucket', bucket);
    url.searchParams.set('path', path);
    url.searchParams.set('expires', String(expires));
    url.searchParams.set(
      'signature',
      await hmac(this.signingSecret, `${bucket}\0${path}\0${expires}`),
    );
    return url.toString();
  }

  /** Mount only at GET /private/lawyer-file in the authenticated API Worker. */
  async serveSignedFile(request: Request): Promise<Response> {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const url = new URL(request.url);
    const bucket = url.searchParams.get('bucket') ?? '';
    const path = url.searchParams.get('path') ?? '';
    const expires = url.searchParams.get('expires') ?? '';
    const signature = url.searchParams.get('signature') ?? '';
    const now = Math.floor(this.now().getTime() / 1000);
    if (
      !buckets.has(bucket) ||
      !/^\d{10}$/.test(expires) ||
      Number(expires) <= now ||
      Number(expires) > now + 900 ||
      path.length > 512 ||
      path.includes('..') ||
      !/^[a-zA-Z0-9_./-]+$/.test(path)
    )
      return new Response(null, { status: 403 });
    const expected = await hmac(this.signingSecret, `${bucket}\0${path}\0${expires}`);
    if (!sameHex(signature, expected)) return new Response(null, { status: 403 });
    const metadata = await this.db
      .prepare(
        'SELECT mime_type,kind FROM verification_documents WHERE storage_bucket=? AND storage_path=?',
      )
      .bind(bucket, path)
      .first<{ mime_type: string; kind: string }>();
    if (!metadata) return new Response(null, { status: 404 });
    const object = await this.r2.get(objectKey(bucket, path));
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': metadata.mime_type,
        'Content-Disposition': metadata.kind === 'profile_image' ? 'inline' : 'attachment',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}
