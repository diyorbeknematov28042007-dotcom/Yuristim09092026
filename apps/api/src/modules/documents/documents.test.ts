import { createHash, randomUUID } from 'node:crypto';
import { ContributionRepositoryError } from '@yuristim/db';
import type { FastifyInstance } from 'fastify';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { MemoryCoreRepository } from '../../testing/memory-core-repository.js';
import { MemoryLawyerRepository } from '../../testing/memory-lawyer-repository.js';
import { MemoryDocumentContributionRepository } from '../../testing/memory-document-contribution-repository.js';
import { CoreAuthService } from '../auth/service.js';
import { AdminService } from '../admin/service.js';
import { DocumentContributionService, validateDocumentBytes } from './service.js';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\n%%EOF\n');
const input = {
  documentType: 'ishonchnoma',
  originalFilename: 'synthetic.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: pdf.length,
  privacyAcknowledged: true,
  rightsConfirmed: true,
};
function zip(names = ['[Content_Types].xml', 'word/document.xml']) {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const filename = Buffer.from(name),
      content = Buffer.from('<synthetic/>');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, content);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(content.length, 20);
    directory.writeUInt32LE(content.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += local.length + filename.length + content.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
describe('private document contributions API', () => {
  let app: FastifyInstance,
    repository: MemoryDocumentContributionRepository,
    admins: MemoryLawyerRepository;
  let cookie: string, otherCookie: string, adminCookie: string;
  beforeEach(async () => {
    const core = new MemoryCoreRepository();
    const user = core.seedUser({ pin_hash: 'hash:1234' }),
      other = core.seedUser({ pin_hash: 'hash:1234' });
    const auth = new CoreAuthService(core, {
      challengeTtlSeconds: 600,
      sessionSecret: 'a-test-session-secret-with-more-than-32-characters',
      sessionTtlSeconds: 3600,
      pinHasher: {
        hash: async (pin) => `hash:${pin}`,
        verify: async (hash, pin) => hash === `hash:${pin}`,
      },
    });
    admins = new MemoryLawyerRepository(core);
    const admin = new AdminService(admins, {
      sessionSecret: 'a-test-session-secret-with-more-than-32-characters',
      sessionTtlSeconds: 3600,
    });
    await admin.bootstrap('h2-test-admin', 'synthetic-admin-password');
    repository = new MemoryDocumentContributionRepository();
    app = buildApp({
      logger: false,
      core: {
        production: false,
        internalBotSecret: 'test-internal-secret-with-more-than-32-characters',
        service: auth,
        adminService: admin,
        documentContributionService: new DocumentContributionService(repository),
      },
    });
    const login = async (duid: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/pin/verify',
        payload: { duid, pin: '1234' },
      });
      return String(response.headers['set-cookie']).split(';')[0]!;
    };
    cookie = await login(user.duid);
    otherCookie = await login(other.duid);
    const loginAdmin = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'h2-test-admin', password: 'synthetic-admin-password' },
    });
    adminCookie = String(loginAdmin.headers['set-cookie']).split(';')[0]!;
  });
  afterEach(async () => {
    await app.close();
  });
  const init = (body: object = input, key = randomUUID(), authCookie = cookie) =>
    app.inject({
      method: 'POST',
      url: '/document-contributions/uploads',
      headers: { cookie: authCookie, 'idempotency-key': key },
      payload: body,
    });
  async function submitted(bytes = pdf, body = input) {
    const response = await init(body);
    expect(response.statusCode).toBe(201);
    const id = response.json().contribution.id;
    const row = repository.rows.get(id)!;
    repository.files.set(row.storage_path, { bytes, mime: body.mimeType });
    const result = await app.inject({
      method: 'POST',
      url: `/document-contributions/${id}/submit`,
      headers: { cookie },
      payload: {},
    });
    return { id, result };
  }
  it('rejects unauthenticated init, list, detail and moderation', async () => {
    for (const url of [
      '/document-contributions/me',
      `/document-contributions/${randomUUID()}`,
      '/admin/document-contributions',
    ])
      expect((await app.inject({ url })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/document-contributions/uploads', payload: input }))
        .statusCode,
    ).toBe(401);
  });
  it.each([
    { originalFilename: 'x.exe' },
    { mimeType: 'text/html' },
    { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ])('rejects extension/MIME spoofing %o', async (change) => {
    expect((await init({ ...input, ...change })).statusCode).toBe(415);
    expect(repository.rows.size).toBe(0);
  });
  it('enforces 5 MB and non-empty size on server', async () => {
    expect((await init({ ...input, fileSizeBytes: 5 * 1024 * 1024 + 1 })).statusCode).toBe(413);
    expect((await init({ ...input, fileSizeBytes: 0 })).statusCode).toBe(400);
  });
  it.each(['privacyAcknowledged', 'rightsConfirmed'])('requires %s', async (field) => {
    expect((await init({ ...input, [field]: false })).statusCode).toBe(400);
  });
  it.each(['../secret.pdf', 'folder\\secret.pdf', 'bad\u0000.pdf', 'bad\u202e.pdf'])(
    'rejects unsafe filename %s',
    async (filename) => {
      expect((await init({ ...input, originalFilename: filename })).statusCode).toBe(400);
    },
  );
  it('creates one opaque scoped upload for a double-tap and conflicts on changed metadata', async () => {
    const key = randomUUID();
    const [first, second] = await Promise.all([init(input, key), init(input, key)]);
    expect(first.json().contribution.id).toBe(second.json().contribution.id);
    expect(repository.rows.size).toBe(1);
    expect(first.json().upload.url).not.toContain(input.originalFilename);
    expect((await init({ ...input, originalFilename: 'changed.pdf' }, key)).statusCode).toBe(409);
  });
  it('does not call a draft a submission before storage succeeds', async () => {
    const response = await init();
    const id = response.json().contribution.id;
    expect(
      (await app.inject({ url: '/document-contributions/me', headers: { cookie } })).json().items,
    ).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/document-contributions/${id}/submit`,
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    expect(repository.rows.get(id)!.status).toBe('draft');
  });
  it('accepts PDF, records server SHA-256, and returns only own safe metadata', async () => {
    const { id, result } = await submitted();
    expect(result.statusCode).toBe(200);
    expect(result.json().contribution.status).toBe('submitted');
    expect(repository.rows.get(id)!.file_sha256).toBe(
      createHash('sha256').update(pdf).digest('hex'),
    );
    const mine = await app.inject({ url: '/document-contributions/me', headers: { cookie } });
    expect(mine.json().items).toHaveLength(1);
    expect(mine.body).not.toMatch(/storage_path|file_sha256|user_id|signedUrl/);
    expect(
      (
        await app.inject({ url: '/document-contributions/me', headers: { cookie: otherCookie } })
      ).json().items,
    ).toEqual([]);
  });
  it('supports a DOCX container without extracting or analyzing its content', async () => {
    const bytes = zip();
    const body = {
      ...input,
      originalFilename: 'synthetic.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSizeBytes: bytes.length,
    };
    expect((await submitted(bytes, body)).result.statusCode).toBe(200);
  });
  it('rejects disguised containers, macro/archive traversal and truncated bytes', () => {
    for (const bytes of [
      zip(['file.txt', 'word/document.xml']),
      zip(['[Content_Types].xml', 'word/vbaProject.bin']),
      zip(['[Content_Types].xml', '../word/document.xml']),
      zip().subarray(0, 20),
    ]) {
      expect(() =>
        validateDocumentBytes(
          {
            ...input,
            originalFilename: 'x.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fileSizeBytes: bytes.length,
          },
          bytes,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ).toThrow();
    }
  });
  it('removes invalid uploaded bytes and never commits a fake submission', async () => {
    const bytes = Buffer.alloc(pdf.length, 'x');
    const { id, result } = await submitted(bytes);
    expect(result.statusCode).toBe(415);
    expect(repository.rows.get(id)!.status).toBe('draft');
    expect(repository.files.size).toBe(0);
  });
  it('keeps a successfully stored file retryable when DB submit fails', async () => {
    repository.failSubmit = true;
    const { id, result } = await submitted();
    expect(result.statusCode).toBe(503);
    expect(repository.files.size).toBe(1);
    repository.failSubmit = false;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/document-contributions/${id}/submit`,
          headers: { cookie },
          payload: {},
        })
      ).json().contribution.status,
    ).toBe('submitted');
  });
  it('never leaks signed uploads or bytes through IDOR; signed reads expire in 300 seconds', async () => {
    const { id } = await submitted();
    for (const suffix of ['', '/file'])
      expect(
        (
          await app.inject({
            url: `/document-contributions/${id}${suffix}`,
            headers: { cookie: otherCookie },
          })
        ).statusCode,
      ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/document-contributions/${id}/submit`,
          headers: { cookie: otherCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    const file = await app.inject({
      url: `/document-contributions/${id}/file`,
      headers: { cookie },
    });
    expect(file.json().expiresInSeconds).toBe(300);
    expect(file.headers['cache-control']).toBe('no-store');
  });
  it('supports exact same-file hash signals without automatic rejection or reward', async () => {
    const one = await submitted(),
      two = await submitted();
    expect(one.id).not.toBe(two.id);
    expect(repository.rows.get(one.id)!.file_sha256).toBe(repository.rows.get(two.id)!.file_sha256);
  });
  it('allows only active admins to read queue and file', async () => {
    const { id } = await submitted();
    expect(
      (
        await app.inject({ url: '/admin/document-contributions', headers: { cookie: adminCookie } })
      ).json().items,
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          url: `/admin/document-contributions/${id}/file`,
          headers: { cookie: adminCookie },
        })
      ).json().expiresInSeconds,
    ).toBe(300);
    for (const account of admins.admins.values()) account.role = 'support';
    expect(
      (await app.inject({ url: '/admin/document-contributions', headers: { cookie: adminCookie } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/admin/document-contributions/${id}/approve`,
          headers: { cookie: adminCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it('under-review → approve is audited once and never publishes or makes a template', async () => {
    const { id } = await submitted();
    for (const action of ['under-review', 'approve'])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/admin/document-contributions/${id}/${action}`,
            headers: { cookie: adminCookie },
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
    expect(repository.audit.map((a) => a.action)).toEqual(['under_review', 'approved']);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/admin/document-contributions/${id}/approve`,
          headers: { cookie: adminCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ url: `/document-contributions/${id}`, headers: { cookie } })).json()
        .contribution.status,
    ).toBe('approved');
  });
  it('requires rejection reason and makes the real reason visible only to owner', async () => {
    const { id } = await submitted();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/admin/document-contributions/${id}/reject`,
          headers: { cookie: adminCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/admin/document-contributions/${id}/reject`,
          headers: { cookie: adminCookie },
          payload: { reason: 'Synthetic fixture rejected' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `/document-contributions/${id}`, headers: { cookie } })).json()
        .contribution.rejectionReason,
    ).toBe('Synthetic fixture rejected');
  });
  it('maps the non-retryable PostgREST conflict to a safe HTTP 409', async () => {
    const { id } = await submitted();
    repository.review = async () => {
      throw new ContributionRepositoryError('PT409');
    };
    const response = await app.inject({
      method: 'POST',
      url: `/admin/document-contributions/${id}/approve`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('DOCUMENT_CONFLICT');
    expect(response.body).not.toContain('PT409');
  });
});
