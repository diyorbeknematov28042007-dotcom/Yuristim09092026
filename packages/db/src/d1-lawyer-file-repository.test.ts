import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  D1LawyerFileRepository,
  type D1LawyerFileBinding,
  type PrivateR2Bucket,
} from './d1-lawyer-file-repository.js';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const filePath = 'l/v/123e4567-e89b-42d3-a456-426614174000.pdf';
const secret = 'file-signing-secret-at-least-thirty-two-characters';
function binding(db: DatabaseSync): D1LawyerFileBinding {
  return {
    prepare(sql: string) {
      let args: Array<string | number | null> = [];
      return {
        bind(...values: Array<string | number | null>) {
          args = values;
          return this;
        },
        async first<T>() {
          return (db.prepare(sql).get(...args) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...args) as T[] };
        },
      };
    },
  };
}
describe('private verification files with D1 metadata and R2 bindings', () => {
  let db: DatabaseSync;
  let files: Map<string, Uint8Array>;
  let bucket: PrivateR2Bucket;
  let repository: D1LawyerFileRepository;
  let now: Date;
  let onPut: (() => void) | undefined;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of [
      '0001_core_auth.sql',
      '0002_identifier_guards.sql',
      '0003_lawyer_admin.sql',
    ])
      db.exec(readFileSync(new URL(`../../../cloudflare/d1/${name}`, import.meta.url), 'utf8'));
    db.prepare(
      "INSERT INTO users(id,telegram_user_id,duid) VALUES('u',42,'yr_abcdefghijklmnop')",
    ).run();
    db.prepare(
      "INSERT INTO lawyer_profiles(id,user_id,public_slug) VALUES('l','u','yr_abcdefghijklmnop')",
    ).run();
    db.prepare(
      "INSERT INTO lawyer_verifications(id,lawyer_id,type,status) VALUES('v','l','initial','draft')",
    ).run();
    files = new Map();
    onPut = undefined;
    bucket = {
      async put(key, bytes) {
        if (files.has(key)) return null;
        files.set(key, bytes);
        onPut?.();
        return { key };
      },
      async get(key) {
        const value = files.get(key);
        return value ? { body: new Blob([new Uint8Array(value)]).stream() } : null;
      },
      async delete(key) {
        files.delete(key);
      },
    };
    now = NOW;
    repository = new D1LawyerFileRepository(
      binding(db),
      bucket,
      'https://api.example.test',
      secret,
      () => now,
    );
  });
  afterEach(() => db.close());
  const input = {
    bytes: new Uint8Array([37, 80, 68, 70, 45, 49]),
    contentType: 'application/pdf' as const,
    kind: 'verification_document' as const,
    originalFilename: 'license.pdf',
    storagePath: filePath,
    verificationId: 'v',
  };
  it('uses a private R2 key, a short signed capability and D1 metadata', async () => {
    const inserted = await repository.addVerificationDocument(input);
    expect(inserted.storage_bucket).toBe('lawyer-verification');
    expect(files.has(`lawyer-verification/${filePath}`)).toBe(true);
    expect((await repository.listVerificationDocuments('v')).map((item) => item.id)).toEqual([
      inserted.id,
    ]);
    const url = await repository.createSignedUrl('lawyer-verification', filePath, 300);
    const response = await repository.serveSignedFile(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Disposition')).toBe('attachment');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(input.bytes);
    const tampered = new URL(url);
    tampered.searchParams.set('path', 'l/v/not-the-file.pdf');
    expect((await repository.serveSignedFile(new Request(tampered))).status).toBe(403);
    now = new Date(NOW.getTime() + 301_000);
    expect((await repository.serveSignedFile(new Request(url))).status).toBe(403);
  });
  it('refuses a closed draft and cleans up an R2 object if submission races with upload', async () => {
    onPut = () => {
      db.prepare(
        "UPDATE lawyer_verifications SET status='pending_review',submitted_at=? WHERE id='v'",
      ).run(NOW.toISOString());
    };
    await expect(repository.addVerificationDocument(input)).rejects.toThrow(
      'Verification draft is closed',
    );
    expect(files.size).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS total FROM verification_documents').get()).toEqual({
      total: 0,
    });
    await expect(repository.addVerificationDocument(input)).rejects.toThrow(
      'Invalid verification upload',
    );
  });
  it('never signs paths absent from D1, limits lifetime and blocks overwrites', async () => {
    await expect(repository.createSignedUrl('lawyer-verification', filePath, 300)).rejects.toThrow(
      'not found',
    );
    await repository.addVerificationDocument(input);
    await expect(repository.addVerificationDocument(input)).rejects.toThrow('already exists');
    await expect(repository.createSignedUrl('lawyer-verification', filePath, 901)).rejects.toThrow(
      'Invalid file capability',
    );
    expect(files.size).toBe(1);
  });
});
