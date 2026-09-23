import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types.js';
import type {
  AdminAccountRow,
  AdminSessionRow,
  FileUploadInput,
  LawyerProfileRecord,
  LawyerRepository,
  LawyerSearchInput,
  LawyerSearchResult,
  LawyerVerificationRow,
  SpecializationRow,
  VerificationDocumentRow,
  VerificationListInput,
  VerificationRecord,
} from './lawyer-repository.js';

function databaseFailure(error: PostgrestError): never {
  throw new Error(`Database operation failed (${error.code})`);
}

function required<T>(data: T | null, error: PostgrestError | null): T {
  if (error) databaseFailure(error);
  if (data === null) throw new Error('Database operation returned no data');
  return data;
}

type RawProfile = Database['public']['Tables']['lawyer_profiles']['Row'] & {
  users: Database['public']['Tables']['users']['Row'];
  lawyer_specializations: Array<{ specializations: SpecializationRow }>;
};

function profileRecord(data: RawProfile): LawyerProfileRecord {
  const { users, lawyer_specializations: joins, ...profile } = data;
  return { profile, specializations: joins.map((item) => item.specializations), user: users };
}

const profileSelect = '*, users!inner(*), lawyer_specializations(specializations!inner(*))';

export class SupabaseLawyerRepository implements LawyerRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async findProfileByUserId(userId: string): Promise<LawyerProfileRecord | null> {
    const { data, error } = await this.client
      .from('lawyer_profiles')
      .select(profileSelect)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) databaseFailure(error);
    return data ? profileRecord(data as unknown as RawProfile) : null;
  }

  async findApprovedProfileByDuid(duid: string): Promise<LawyerProfileRecord | null> {
    const { data, error } = await this.client
      .from('lawyer_profiles')
      .select(profileSelect)
      .eq('public_slug', duid)
      .eq('verification_status', 'approved')
      .maybeSingle();
    if (error) databaseFailure(error);
    return data ? profileRecord(data as unknown as RawProfile) : null;
  }

  async createProfile(userId: string, publicSlug: string): Promise<LawyerProfileRecord> {
    const { error } = await this.client
      .from('lawyer_profiles')
      .insert({ public_slug: publicSlug, user_id: userId });
    if (error && error.code !== '23505') databaseFailure(error);
    const profile = await this.findProfileByUserId(userId);
    if (!profile) throw new Error('Lawyer profile was not created');
    return profile;
  }

  async listSpecializations(): Promise<SpecializationRow[]> {
    const { data, error } = await this.client
      .from('specializations')
      .select('*')
      .eq('active', true)
      .order('code');
    if (error) databaseFailure(error);
    return data;
  }

  async findSpecializationsByCodes(codes: string[]): Promise<SpecializationRow[]> {
    if (codes.length === 0) return [];
    const { data, error } = await this.client
      .from('specializations')
      .select('*')
      .eq('active', true)
      .in('code', codes);
    if (error) databaseFailure(error);
    return data;
  }

  async searchApproved(input: LawyerSearchInput): Promise<LawyerSearchResult> {
    let query = this.client
      .from('lawyer_profiles')
      .select(profileSelect, { count: 'exact' })
      .eq('verification_status', 'approved');
    if (input.region) query = query.eq('region', input.region);
    if (input.minExperience !== undefined)
      query = query.gte('experience_years', input.minExperience);
    if (input.specialization)
      query = query.eq('lawyer_specializations.specializations.code', input.specialization);
    const order =
      input.sort === 'experience'
        ? 'experience_years'
        : input.sort === 'newest'
          ? 'verified_at'
          : 'rating_average';
    const start = (input.page - 1) * input.limit;
    const { data, error, count } = await query
      .order(order, { ascending: false })
      .range(start, start + input.limit - 1);
    if (error) databaseFailure(error);
    return { items: (data as unknown as RawProfile[]).map(profileRecord), total: count ?? 0 };
  }

  async findLatestVerification(lawyerId: string): Promise<LawyerVerificationRow | null> {
    const { data, error } = await this.client
      .from('lawyer_verifications')
      .select('*')
      .eq('lawyer_id', lawyerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) databaseFailure(error);
    return data;
  }

  async findOpenVerification(lawyerId: string): Promise<LawyerVerificationRow | null> {
    const { data, error } = await this.client
      .from('lawyer_verifications')
      .select('*')
      .eq('lawyer_id', lawyerId)
      .in('status', ['draft', 'submitted', 'pending_review'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) databaseFailure(error);
    return data;
  }

  async findVerificationById(id: string): Promise<LawyerVerificationRow | null> {
    const { data, error } = await this.client
      .from('lawyer_verifications')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) databaseFailure(error);
    return data;
  }

  async createVerification(input: {
    lawyerId: string;
    type: 'initial' | 'profile_update';
    submittedData: Json;
    status?: 'draft' | 'pending_review';
    now: Date;
  }): Promise<LawyerVerificationRow> {
    const submitted = input.status === 'pending_review';
    const { data, error } = await this.client
      .from('lawyer_verifications')
      .insert({
        lawyer_id: input.lawyerId,
        status: input.status ?? 'draft',
        submitted_at: submitted ? input.now.toISOString() : null,
        submitted_data: input.submittedData,
        type: input.type,
      })
      .select('*')
      .single();
    return required(data, error);
  }

  async updateDraft(id: string, submittedData: Json): Promise<LawyerVerificationRow> {
    const { data, error } = await this.client
      .from('lawyer_verifications')
      .update({ submitted_data: submittedData })
      .eq('id', id)
      .eq('status', 'draft')
      .select('*')
      .single();
    return required(data, error);
  }

  async submitDraft(
    id: string,
    submittedData: Json,
    now: Date,
  ): Promise<LawyerVerificationRow | null> {
    const { data, error } = await this.client
      .from('lawyer_verifications')
      .update({
        status: 'pending_review',
        submitted_at: now.toISOString(),
        submitted_data: submittedData,
      })
      .eq('id', id)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle();
    if (error) databaseFailure(error);
    return data;
  }

  async cancelDraft(id: string): Promise<void> {
    const { error } = await this.client
      .from('lawyer_verifications')
      .delete()
      .eq('id', id)
      .eq('status', 'draft');
    if (error) databaseFailure(error);
  }

  async addVerificationDocument(input: FileUploadInput): Promise<VerificationDocumentRow> {
    const bucket = input.kind === 'profile_image' ? 'profile-images' : 'lawyer-verification';
    const { error: uploadError } = await this.client.storage
      .from(bucket)
      .upload(input.storagePath, input.bytes, { contentType: input.contentType, upsert: false });
    if (uploadError) throw new Error('Storage upload failed');
    const { data, error } = await this.client
      .from('verification_documents')
      .insert({
        kind: input.kind,
        mime_type: input.contentType,
        original_filename: input.originalFilename,
        size_bytes: input.bytes.byteLength,
        storage_bucket: bucket,
        storage_path: input.storagePath,
        verification_id: input.verificationId,
      })
      .select('*')
      .single();
    if (error) {
      await this.client.storage.from(bucket).remove([input.storagePath]);
      databaseFailure(error);
    }
    return required(data, error);
  }

  async listVerificationDocuments(verificationId: string): Promise<VerificationDocumentRow[]> {
    const { data, error } = await this.client
      .from('verification_documents')
      .select('*')
      .eq('verification_id', verificationId)
      .order('created_at');
    if (error) databaseFailure(error);
    return data;
  }

  async createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error) throw new Error('Could not create signed file URL');
    return data.signedUrl;
  }

  async findAdminByUsername(username: string): Promise<AdminAccountRow | null> {
    const { data, error } = await this.client
      .from('admin_accounts')
      .select('*')
      .eq('username', username)
      .maybeSingle();
    if (error) databaseFailure(error);
    return data;
  }

  async findAdminById(id: string): Promise<AdminAccountRow | null> {
    const { data, error } = await this.client
      .from('admin_accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) databaseFailure(error);
    return data;
  }

  async createAdmin(username: string, passwordHash: string): Promise<AdminAccountRow> {
    const { data, error } = await this.client
      .from('admin_accounts')
      .insert({ password_hash: passwordHash, username })
      .select('*')
      .single();
    return required(data, error);
  }

  async updateAdminLoginState(
    id: string,
    update: Database['public']['Tables']['admin_accounts']['Update'],
  ): Promise<AdminAccountRow> {
    const { data, error } = await this.client
      .from('admin_accounts')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    return required(data, error);
  }

  async createAdminSession(input: {
    adminId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
  }): Promise<AdminSessionRow> {
    const { data, error } = await this.client
      .from('admin_sessions')
      .insert({
        admin_id: input.adminId,
        created_at: input.now.toISOString(),
        expires_at: input.expiresAt.toISOString(),
        last_seen_at: input.now.toISOString(),
        token_hash: input.tokenHash,
      })
      .select('*')
      .single();
    return required(data, error);
  }

  async findAdminSessionByTokenHash(tokenHash: string): Promise<AdminSessionRow | null> {
    const { data, error } = await this.client
      .from('admin_sessions')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (error) databaseFailure(error);
    return data;
  }

  async touchAdminSession(id: string, now: Date): Promise<void> {
    const { error } = await this.client
      .from('admin_sessions')
      .update({ last_seen_at: now.toISOString() })
      .eq('id', id);
    if (error) databaseFailure(error);
  }

  async revokeAdminSession(id: string, now: Date): Promise<void> {
    const { error } = await this.client
      .from('admin_sessions')
      .update({ revoked_at: now.toISOString() })
      .eq('id', id)
      .is('revoked_at', null);
    if (error) databaseFailure(error);
  }

  async logAdminLogin(input: {
    adminId: string | null;
    username: string;
    success: boolean;
    ip: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<void> {
    const { error } = await this.client.from('admin_login_logs').insert({
      admin_id: input.adminId,
      created_at: input.now.toISOString(),
      ip: input.ip,
      success: input.success,
      user_agent: input.userAgent,
      username: input.username,
    });
    if (error) databaseFailure(error);
  }

  async listVerifications(
    input: VerificationListInput,
  ): Promise<{ items: VerificationRecord[]; total: number }> {
    let query = this.client.from('lawyer_verifications').select('*', { count: 'exact' });
    if (input.status) query = query.eq('status', input.status);
    const start = (input.page - 1) * input.limit;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(start, start + input.limit - 1);
    if (error) databaseFailure(error);
    const items = await Promise.all(
      data.map((verification) => this.hydrateVerification(verification)),
    );
    return { items, total: count ?? 0 };
  }

  async getVerificationDetail(id: string): Promise<VerificationRecord | null> {
    const verification = await this.findVerificationById(id);
    return verification ? this.hydrateVerification(verification) : null;
  }

  async reviewVerification(input: {
    verificationId: string;
    adminId: string;
    decision: 'approved' | 'rejected';
    rejectReason: string | null;
  }): Promise<'reviewed' | 'not_found' | 'conflict'> {
    const { error } = await this.client.rpc('review_lawyer_verification', {
      p_admin_id: input.adminId,
      p_decision: input.decision,
      ...(input.rejectReason ? { p_reject_reason: input.rejectReason } : {}),
      p_verification_id: input.verificationId,
    });
    if (!error) return 'reviewed';
    if (error.code === 'P0002') return 'not_found';
    if (error.code === '40001') return 'conflict';
    databaseFailure(error);
  }

  private async hydrateVerification(
    verification: LawyerVerificationRow,
  ): Promise<VerificationRecord> {
    const { data, error } = await this.client
      .from('lawyer_profiles')
      .select(profileSelect)
      .eq('id', verification.lawyer_id)
      .single();
    if (error) databaseFailure(error);
    return {
      documents: await this.listVerificationDocuments(verification.id),
      profile: profileRecord(data as unknown as RawProfile),
      verification,
    };
  }
}
