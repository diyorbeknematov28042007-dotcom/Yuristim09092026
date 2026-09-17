export type MarketplacePostStatus = 'draft' | 'open' | 'selected' | 'cancelled' | 'expired';
export type MarketplaceAcceptanceStatus = 'accepted' | 'selected' | 'not_selected' | 'cancelled';

export interface MarketplaceDraftRow {
  user_id: string;
  specialization_code: string | null;
  description: string | null;
  region: string | null;
  additional_details: string | null;
  step: 'specialization' | 'description' | 'region' | 'additional_details' | 'preview';
  updated_at: string;
  language: 'uz' | 'ru' | 'en';
}

export interface MarketplacePostRow {
  id: string;
  public_identifier: string;
  user_id: string;
  specialization_id: string;
  specialization_code: string;
  specialization_name_uz: string;
  specialization_name_ru: string;
  specialization_name_en: string;
  description: string;
  region: string | null;
  additional_details: string | null;
  status: MarketplacePostStatus;
  max_acceptances: number;
  acceptance_count: number;
  selected_acceptance_id: string | null;
  telegram_channel_message_id: number | null;
  created_at: string;
  updated_at: string;
  selected_at: string | null;
  cancelled_at: string | null;
  expires_at: string | null;
}

export interface MarketplaceLawyerAcceptanceRow {
  id: string;
  marketplace_post_id: string;
  lawyer_id: string;
  status: MarketplaceAcceptanceStatus;
  accepted_at: string;
  selected_at: string | null;
  full_name: string;
  duid: string;
  public_slug: string;
  region: string | null;
  rating_average: number;
  rating_count: number;
  specializations: Array<{ code: string; name_uz: string; name_ru: string; name_en: string }>;
}

export interface MarketplaceAcceptResult {
  acceptanceId: string;
  postId: string;
  ledgerTransactionId: string;
  duplicate: boolean;
}

export interface MarketplaceSelectionResult {
  postId: string;
  acceptanceId: string;
  lawyerId: string;
  duplicate: boolean;
}

export interface MarketplaceReviewRow {
  id: string;
  marketplace_post_id: string;
  user_id: string;
  lawyer_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface MarketplaceRepository {
  expirePosts(now: Date): Promise<number>;
  getDraft(userId: string): Promise<MarketplaceDraftRow | null>;
  saveDraft(input: Omit<MarketplaceDraftRow, 'updated_at'>): Promise<MarketplaceDraftRow>;
  deleteDraft(userId: string): Promise<void>;
  createPost(input: {
    userId: string;
    specializationCode: string;
    description: string;
    region: string | null;
    additionalDetails: string | null;
    idempotencyKey: string;
    expiresAt: Date | null;
    now: Date;
    language: 'uz' | 'ru' | 'en';
  }): Promise<MarketplacePostRow>;
  listOwnedPosts(userId: string): Promise<MarketplacePostRow[]>;
  findOwnedPost(postId: string, userId: string): Promise<MarketplacePostRow | null>;
  findPublicPost(publicIdentifier: string): Promise<MarketplacePostRow | null>;
  setChannelMessage(postId: string, messageId: number): Promise<void>;
  recordPublicationFailure(postId: string): Promise<void>;
  acceptPost(publicIdentifier: string, userId: string, now: Date): Promise<MarketplaceAcceptResult>;
  listPostAcceptances(
    postId: string,
    ownerUserId: string,
  ): Promise<MarketplaceLawyerAcceptanceRow[]>;
  listLawyerAcceptances(userId: string): Promise<MarketplacePostRow[]>;
  selectLawyer(input: {
    postId: string;
    userId: string;
    acceptanceId: string;
    now: Date;
  }): Promise<MarketplaceSelectionResult>;
  cancelPost(postId: string, userId: string, now: Date): Promise<MarketplacePostRow>;
  createReview(input: {
    postId: string;
    userId: string;
    rating: number;
    comment: string | null;
    now: Date;
  }): Promise<MarketplaceReviewRow>;
  getOwnerTelegramId(postId: string): Promise<number | null>;
  getLawyerTelegramId(lawyerId: string): Promise<number | null>;
  getAcceptedLawyerTelegramIds(postId: string): Promise<number[]>;
}
