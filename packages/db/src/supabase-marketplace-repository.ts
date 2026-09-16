/* Supabase relationship payloads remain dynamic until production types are regenerated post-migration. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from 'node:crypto';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import type {
  MarketplaceAcceptResult,
  MarketplaceDraftRow,
  MarketplaceLawyerAcceptanceRow,
  MarketplacePostRow,
  MarketplaceRepository,
  MarketplaceReviewRow,
  MarketplaceSelectionResult,
} from './marketplace-repository.js';

type LooseClient = SupabaseClient<any>;

function fail(error: PostgrestError): never {
  throw Object.assign(new Error(`Database operation failed (${error.code})`), {
    databaseCode: error.code,
    databaseMessage: error.message,
  });
}

function domainFail(code: string): never {
  throw Object.assign(new Error(`Marketplace operation failed (${code})`), {
    databaseCode: code,
    databaseMessage: code,
  });
}

function requireData<T>(data: T | null, error: PostgrestError | null): T {
  if (error) fail(error);
  if (data === null) throw new Error('Database operation returned no data');
  return data;
}

function opaque(prefix: 'ma' | 'mp', bytes: number): string {
  return `${prefix}_${randomBytes(bytes).toString('hex')}`;
}

const postSelect = `
  *,
  specializations!marketplace_posts_specialization_id_fkey(code,name_uz,name_ru,name_en),
  marketplace_acceptances(count)
`;

function one(value: any): any {
  return Array.isArray(value) ? value[0] : value;
}

function postRow(value: any): MarketplacePostRow {
  const specialization = one(value.specializations) ?? {
    code: '',
    name_en: '',
    name_ru: '',
    name_uz: '',
  };
  return {
    acceptance_count: Number(value.marketplace_acceptances?.[0]?.count ?? 0),
    additional_details: value.additional_details ?? null,
    cancelled_at: value.cancelled_at,
    created_at: value.created_at,
    description: value.description ?? '',
    expires_at: value.expires_at,
    id: value.id,
    max_acceptances: value.max_acceptances,
    public_identifier: value.public_id,
    region: value.region,
    selected_acceptance_id: value.selected_acceptance_id,
    selected_at: value.selected_at,
    specialization_code: specialization.code,
    specialization_id: value.specialization_id ?? '',
    specialization_name_en: specialization.name_en,
    specialization_name_ru: specialization.name_ru,
    specialization_name_uz: specialization.name_uz,
    status: value.status,
    telegram_channel_message_id: value.channel_message_id,
    updated_at: value.updated_at,
    user_id: value.user_id,
  };
}

function draftRow(value: any): MarketplaceDraftRow {
  const specialization = one(value.specializations);
  return {
    additional_details: value.additional_details ?? null,
    description: value.description,
    language: value.language,
    region: value.region,
    specialization_code: specialization?.code ?? null,
    step: value.draft_step,
    updated_at: value.updated_at,
    user_id: value.user_id,
  };
}

export class SupabaseMarketplaceRepository implements MarketplaceRepository {
  private readonly client: LooseClient;

  constructor(client: SupabaseClient<Database>) {
    this.client = client as LooseClient;
  }

  async expirePosts(now: Date): Promise<number> {
    const { data, error } = await this.client.rpc('expire_marketplace_posts', {
      p_now: now.toISOString(),
    });
    return Number(requireData(data, error));
  }

  async getDraft(userId: string): Promise<MarketplaceDraftRow | null> {
    const { data, error } = await this.client
      .from('marketplace_posts')
      .select(postSelect)
      .eq('user_id', userId)
      .eq('status', 'draft')
      .maybeSingle();
    if (error) fail(error);
    return data ? draftRow(data) : null;
  }

  async saveDraft(input: Omit<MarketplaceDraftRow, 'updated_at'>): Promise<MarketplaceDraftRow> {
    let current = await this.getDraft(input.user_id);
    if (!current) {
      const { error } = await this.client.rpc('create_marketplace_draft', {
        p_idempotency_key: `draft:${input.user_id}`,
        p_language: input.language,
        p_public_id: opaque('mp', 12),
        p_user_id: input.user_id,
      });
      if (error) fail(error);
      current = await this.getDraft(input.user_id);
    }
    if (!current) throw new Error('Marketplace draft was not created');

    let specializationId: string | null = null;
    if (input.specialization_code) {
      const { data, error } = await this.client
        .from('specializations')
        .select('id')
        .eq('code', input.specialization_code)
        .eq('active', true)
        .maybeSingle();
      if (error) fail(error);
      if (!data) domainFail('INVALID_SPECIALIZATION');
      specializationId = data.id;
    }
    const { data, error } = await this.client
      .from('marketplace_posts')
      .update({
        additional_details: input.additional_details,
        description: input.description,
        draft_step: input.step,
        region: input.region,
        specialization_id: specializationId,
      })
      .eq('user_id', input.user_id)
      .eq('status', 'draft')
      .select(postSelect)
      .single();
    return draftRow(requireData(data, error));
  }

  async deleteDraft(userId: string): Promise<void> {
    const { error } = await this.client
      .from('marketplace_posts')
      .delete()
      .eq('user_id', userId)
      .eq('status', 'draft');
    if (error) fail(error);
  }

  async createPost(
    input: Parameters<MarketplaceRepository['createPost']>[0],
  ): Promise<MarketplacePostRow> {
    const { data, error } = await this.client.rpc('create_marketplace_post', {
      p_additional_details: input.additionalDetails,
      p_description: input.description,
      p_expires_at: input.expiresAt?.toISOString() ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_language: input.language,
      p_now: input.now.toISOString(),
      p_public_id: opaque('mp', 12),
      p_region: input.region,
      p_specialization_code: input.specializationCode,
      p_user_id: input.userId,
    });
    if (error) fail(error);
    return this.requirePost(data.id);
  }

  async listOwnedPosts(userId: string): Promise<MarketplacePostRow[]> {
    const { data, error } = await this.client
      .from('marketplace_posts')
      .select(postSelect)
      .eq('user_id', userId)
      .neq('status', 'draft')
      .order('created_at', { ascending: false });
    if (error) fail(error);
    return (data as any[]).map(postRow);
  }

  async findOwnedPost(postId: string, userId: string): Promise<MarketplacePostRow | null> {
    const { data, error } = await this.client
      .from('marketplace_posts')
      .select(postSelect)
      .eq('id', postId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) fail(error);
    return data ? postRow(data) : null;
  }

  async findPublicPost(publicIdentifier: string): Promise<MarketplacePostRow | null> {
    const { data, error } = await this.client
      .from('marketplace_posts')
      .select(postSelect)
      .eq('public_id', publicIdentifier)
      .neq('status', 'draft')
      .maybeSingle();
    if (error) fail(error);
    return data ? postRow(data) : null;
  }

  async setChannelMessage(postId: string, messageId: number): Promise<void> {
    const post = await this.requirePost(postId);
    const { error } = await this.client.rpc('record_marketplace_publication', {
      p_channel_message_id: messageId,
      p_public_id: post.public_identifier,
    });
    if (error) fail(error);
  }

  async recordPublicationFailure(postId: string): Promise<void> {
    const post = await this.requirePost(postId);
    const { error } = await this.client.rpc('record_marketplace_publication_failure', {
      p_public_id: post.public_identifier,
    });
    if (error) fail(error);
  }

  async acceptPost(
    publicIdentifier: string,
    userId: string,
    now: Date,
  ): Promise<MarketplaceAcceptResult> {
    const { data, error } = await this.client.rpc('accept_marketplace_post', {
      p_acceptance_public_id: opaque('ma', 10),
      p_now: now.toISOString(),
      p_public_id: publicIdentifier,
      p_user_id: userId,
    });
    if (error) fail(error);
    if (!data?.ok) domainFail(data?.code ?? 'INTERNAL_ERROR');
    return {
      acceptanceId: data.acceptancePublicId,
      duplicate: data.duplicate,
      ledgerTransactionId: data.ledgerTransactionId,
      postId: data.postId,
    };
  }

  async listPostAcceptances(
    postId: string,
    ownerUserId: string,
  ): Promise<MarketplaceLawyerAcceptanceRow[]> {
    const owned = await this.findOwnedPost(postId, ownerUserId);
    if (!owned) return [];
    const { data, error } = await this.client
      .from('marketplace_acceptances')
      .select(
        `
        id,public_id,marketplace_post_id,lawyer_id,status,accepted_at,selected_at,
        lawyer_profiles!marketplace_acceptances_lawyer_id_fkey(
          public_slug,region,rating_average,rating_count,
          users!lawyer_profiles_user_id_fkey(full_name,duid),
          lawyer_specializations(
            specializations!lawyer_specializations_specialization_id_fkey(code,name_uz,name_ru,name_en)
          )
        )
      `,
      )
      .eq('marketplace_post_id', postId)
      .order('accepted_at');
    if (error) fail(error);
    return (data as any[]).map((row) => {
      const profile = one(row.lawyer_profiles);
      const profileUser = one(profile.users);
      return {
        accepted_at: row.accepted_at,
        duid: profileUser.duid,
        full_name: profileUser.full_name ?? 'Verified lawyer',
        id: row.public_id,
        lawyer_id: row.lawyer_id,
        marketplace_post_id: row.marketplace_post_id,
        public_slug: profile.public_slug,
        rating_average: Number(profile.rating_average),
        rating_count: profile.rating_count,
        region: profile.region,
        selected_at: row.selected_at,
        specializations: profile.lawyer_specializations.map((item: any) =>
          one(item.specializations),
        ),
        status: row.status,
      };
    });
  }

  async listLawyerAcceptances(userId: string): Promise<MarketplacePostRow[]> {
    const { data: lawyer, error: lawyerError } = await this.client
      .from('lawyer_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (lawyerError) fail(lawyerError);
    if (!lawyer) return [];
    const { data, error } = await this.client
      .from('marketplace_acceptances')
      .select(`marketplace_posts!marketplace_acceptances_marketplace_post_id_fkey(${postSelect})`)
      .eq('lawyer_id', lawyer.id)
      .order('accepted_at', { ascending: false });
    if (error) fail(error);
    return (data as any[]).map((row) => postRow(one(row.marketplace_posts)));
  }

  async selectLawyer(
    input: Parameters<MarketplaceRepository['selectLawyer']>[0],
  ): Promise<MarketplaceSelectionResult> {
    const post = await this.requirePost(input.postId);
    const { data, error } = await this.client.rpc('select_marketplace_lawyer', {
      p_acceptance_public_id: input.acceptanceId,
      p_now: input.now.toISOString(),
      p_post_public_id: post.public_identifier,
      p_user_id: input.userId,
    });
    if (error) fail(error);
    if (!data?.ok) domainFail(data?.code ?? 'INTERNAL_ERROR');
    return {
      acceptanceId: data.acceptancePublicId,
      duplicate: data.duplicate,
      lawyerId: data.lawyerId,
      postId: data.postId,
    };
  }

  async cancelPost(postId: string, userId: string, now: Date): Promise<MarketplacePostRow> {
    const post = await this.requirePost(postId);
    const { data, error } = await this.client.rpc('cancel_marketplace_post', {
      p_now: now.toISOString(),
      p_public_id: post.public_identifier,
      p_user_id: userId,
    });
    if (error) fail(error);
    if (!data?.ok) domainFail(data?.code ?? 'INTERNAL_ERROR');
    return this.requirePost(postId);
  }

  async createReview(
    input: Parameters<MarketplaceRepository['createReview']>[0],
  ): Promise<MarketplaceReviewRow> {
    const post = await this.requirePost(input.postId);
    const { data, error } = await this.client.rpc('submit_marketplace_review', {
      p_comment: input.comment,
      p_now: input.now.toISOString(),
      p_post_public_id: post.public_identifier,
      p_rating: input.rating,
      p_user_id: input.userId,
    });
    if (error) fail(error);
    if (!data?.ok) domainFail(data?.code ?? 'INTERNAL_ERROR');
    return {
      comment: input.comment,
      created_at: input.now.toISOString(),
      id: data.reviewId,
      lawyer_id: data.lawyerId,
      marketplace_post_id: data.postId,
      rating: data.rating,
      user_id: input.userId,
    };
  }

  async getOwnerTelegramId(postId: string): Promise<number | null> {
    const { data, error } = await this.client
      .from('marketplace_posts')
      .select('users!marketplace_posts_user_id_fkey(telegram_user_id)')
      .eq('id', postId)
      .maybeSingle();
    if (error) fail(error);
    const user = one((data as any)?.users);
    return user?.telegram_user_id ? Number(user.telegram_user_id) : null;
  }

  async getLawyerTelegramId(lawyerId: string): Promise<number | null> {
    const { data, error } = await this.client
      .from('lawyer_profiles')
      .select('users!lawyer_profiles_user_id_fkey(telegram_user_id)')
      .eq('id', lawyerId)
      .maybeSingle();
    if (error) fail(error);
    const user = one((data as any)?.users);
    return user?.telegram_user_id ? Number(user.telegram_user_id) : null;
  }

  async getAcceptedLawyerTelegramIds(postId: string): Promise<number[]> {
    const { data, error } = await this.client
      .from('marketplace_acceptances')
      .select(
        'lawyer_profiles!marketplace_acceptances_lawyer_id_fkey(users!lawyer_profiles_user_id_fkey(telegram_user_id))',
      )
      .eq('marketplace_post_id', postId);
    if (error) fail(error);
    return (data as any[])
      .map((row) => one(one(row.lawyer_profiles)?.users)?.telegram_user_id)
      .filter((value): value is string | number => value !== null && value !== undefined)
      .map(Number);
  }

  private async requirePost(postId: string): Promise<MarketplacePostRow> {
    const { data, error } = await this.client
      .from('marketplace_posts')
      .select(postSelect)
      .eq('id', postId)
      .single();
    return postRow(requireData(data, error));
  }
}
