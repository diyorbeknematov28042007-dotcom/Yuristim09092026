import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import {
  ContributionRepositoryError,
  type ContributionInsert,
  type ContributionPageInput,
  type DocumentContributionRepository,
} from './document-contribution-repository.js';
const BUCKET = 'document-contributions';
function check(error: unknown) {
  if (error)
    throw new ContributionRepositoryError(
      (error as { code?: string }).code ?? 'STORAGE_UNAVAILABLE',
    );
}
export class SupabaseDocumentContributionRepository implements DocumentContributionRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async findByKey(userId: string, key: string) {
    const { data, error } = await this.client
      .from('document_contributions')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .maybeSingle();
    check(error);
    return data;
  }
  async findById(id: string) {
    const { data, error } = await this.client
      .from('document_contributions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    check(error);
    return data;
  }
  async createDraft(input: ContributionInsert) {
    const { data, error } = await this.client
      .from('document_contributions')
      .insert(input)
      .select('*')
      .single();
    if (error?.code === '23505') {
      const row = await this.findByKey(input.user_id, input.idempotency_key);
      if (row) return row;
    }
    check(error);
    if (!data) throw new ContributionRepositoryError('UNAVAILABLE');
    return data;
  }
  async list(input: ContributionPageInput, userId?: string) {
    let q = this.client
      .from('document_contributions')
      .select('*', { count: 'exact' })
      .neq('status', 'draft');
    if (userId) q = q.eq('user_id', userId);
    if (input.status) q = q.eq('status', input.status);
    const { data, count, error } = await q
      .order('submitted_at', { ascending: false })
      .order('id')
      .range((input.page - 1) * input.limit, input.page * input.limit - 1);
    check(error);
    return { items: data ?? [], total: count ?? 0 };
  }
  async signedUpload(path: string) {
    const { data, error } = await this.client.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    check(error);
    if (!data) throw new ContributionRepositoryError('STORAGE_UNAVAILABLE');
    return data.signedUrl;
  }
  async readFile(path: string) {
    const { data, error } = await this.client.storage.from(BUCKET).download(path);
    if (error || !data) throw new ContributionRepositoryError('FILE_NOT_READY');
    if (data.size > 5242880) throw new ContributionRepositoryError('FILE_TOO_LARGE');
    return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type };
  }
  async signedDownload(path: string, filename: string, seconds: number) {
    const { data, error } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(path, seconds, { download: filename });
    check(error);
    if (!data) throw new ContributionRepositoryError('STORAGE_UNAVAILABLE');
    return data.signedUrl;
  }
  async submit(id: string, userId: string, hash: string) {
    const { data, error } = await this.client.rpc('submit_document_contribution', {
      p_id: id,
      p_user_id: userId,
      p_file_sha256: hash,
    });
    check(error);
    if (!data?.[0]) throw new ContributionRepositoryError('UNAVAILABLE');
    return data[0];
  }
  async review(
    id: string,
    adminId: string,
    decision: 'under_review' | 'approved' | 'rejected',
    reason: string | null,
  ) {
    const { data, error } = await this.client.rpc('review_document_contribution', {
      p_id: id,
      p_admin_id: adminId,
      p_decision: decision,
      p_reason: reason,
    });
    check(error);
    if (!data?.[0]) throw new ContributionRepositoryError('UNAVAILABLE');
    return data[0];
  }
  async expiredDrafts(before: Date, limit: number) {
    const { data, error } = await this.client
      .from('document_contributions')
      .select('*')
      .eq('status', 'draft')
      .lt('upload_expires_at', before.toISOString())
      .limit(limit);
    check(error);
    return data ?? [];
  }
  async removeDraft(id: string) {
    const { error } = await this.client
      .from('document_contributions')
      .delete()
      .eq('id', id)
      .eq('status', 'draft');
    check(error);
  }
  async removeFile(path: string) {
    const { error } = await this.client.storage.from(BUCKET).remove([path]);
    check(error);
  }
}
