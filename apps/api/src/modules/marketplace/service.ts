import type {
  MarketplaceDraftRow,
  MarketplacePostRow,
  MarketplaceRepository,
  UserRow,
} from '@yuristim/db';
import type {
  BotMarketplaceDraftAction,
  Language,
  MarketplaceAcceptanceView,
  MarketplaceDraftView,
  MarketplacePostView,
} from '@yuristim/types';
import { AppError } from '../../lib/errors.js';

const DEFAULT_EXPIRY_DAYS = 14;
export const MARKETPLACE_MAX_ACCEPTANCES = 5;

function databaseDetails(error: unknown): { code?: string; message: string } {
  if (!(error instanceof Error)) return { message: '' };
  const value = error as Error & { databaseCode?: string; databaseMessage?: string };
  return {
    ...(value.databaseCode ? { code: value.databaseCode } : {}),
    message: value.databaseMessage ?? value.message,
  };
}

function marketplaceError(error: unknown): never {
  const details = databaseDetails(error);
  if (details.code === 'INVALID_DEEP_LINK' || details.code === 'INVALID_SPECIALIZATION')
    throw new AppError(400, 'VALIDATION_ERROR', 'Marketplace input is invalid');
  if (details.code === 'UNAUTHORIZED')
    throw new AppError(401, 'UNAUTHORIZED', 'Marketplace authentication is required');
  if (details.code === 'P0001' || details.code === 'INSUFFICIENT_ACCEPT_BALANCE')
    throw new AppError(402, 'INSUFFICIENT_ACCEPT_BALANCE', 'Marketplace accept balance is zero');
  if (details.code === 'P0002' || details.code === 'MARKETPLACE_POST_NOT_FOUND')
    throw new AppError(404, 'MARKETPLACE_POST_NOT_FOUND', 'Marketplace resource not found');
  if (details.code === '54000' || details.code === 'MARKETPLACE_CAPACITY_FULL')
    throw new AppError(409, 'MARKETPLACE_CAPACITY_REACHED', 'Marketplace acceptance limit reached');
  if (details.code === 'MARKETPLACE_OWN_POST')
    throw new AppError(403, 'MARKETPLACE_OWNER_CANNOT_ACCEPT', 'Owner cannot accept own request');
  if (
    details.code === 'LAWYER_NOT_VERIFIED' ||
    details.code === 'LAWYER_ROLE_REQUIRED' ||
    details.code === 'LAWYER_MODE_REQUIRED'
  )
    throw new AppError(403, 'LAWYER_NOT_VERIFIED', 'Approved lawyer mode is required');
  if (details.code === 'FORBIDDEN')
    throw new AppError(403, 'MARKETPLACE_FORBIDDEN', 'Marketplace operation is forbidden');
  if (details.code === '42501') {
    if (details.message.includes('owner'))
      throw new AppError(403, 'MARKETPLACE_OWNER_CANNOT_ACCEPT', 'Owner cannot accept own request');
    throw new AppError(403, 'LAWYER_NOT_VERIFIED', 'Approved lawyer mode is required');
  }
  if (details.code === '55000' || details.code === 'MARKETPLACE_POST_CLOSED')
    throw new AppError(409, 'MARKETPLACE_POST_CLOSED', 'Marketplace request is closed');
  if (details.code === '22023')
    throw new AppError(400, 'VALIDATION_ERROR', 'Marketplace input is invalid');
  if (details.code === 'MARKETPLACE_ACCEPTANCE_NOT_FOUND')
    throw new AppError(404, 'MARKETPLACE_ACCEPTANCE_NOT_FOUND', 'Marketplace acceptance not found');
  if (details.code === 'REVIEW_NOT_ALLOWED' || details.code === 'REVIEW_ALREADY_EXISTS')
    throw new AppError(409, 'MARKETPLACE_REVIEW_NOT_ALLOWED', 'Marketplace review is not allowed');
  throw error;
}

function localizedSpecialization(row: MarketplacePostRow, language: Language): string {
  return row[`specialization_name_${language}`];
}

function postView(row: MarketplacePostRow, language: Language): MarketplacePostView {
  return {
    acceptanceCount: row.acceptance_count,
    additionalDetails: row.additional_details,
    createdAt: row.created_at,
    description: row.description,
    expiresAt: row.expires_at,
    id: row.id,
    maxAcceptances: row.max_acceptances,
    publicIdentifier: row.public_identifier,
    region: row.region,
    selectedAcceptanceId: row.selected_acceptance_id,
    specializationCode: row.specialization_code,
    specializationName: localizedSpecialization(row, language),
    status: row.status,
    telegramChannelMessageId: row.telegram_channel_message_id,
  };
}

function draftView(row: MarketplaceDraftRow): MarketplaceDraftView {
  return {
    additionalDetails: row.additional_details,
    description: row.description,
    region: row.region,
    specializationCode: row.specialization_code,
    step: row.step,
  };
}

export class MarketplaceService {
  constructor(
    readonly repository: MarketplaceRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async updateDraft(
    user: UserRow,
    action: BotMarketplaceDraftAction,
  ): Promise<MarketplaceDraftView | null> {
    if (action.action === 'cancel') {
      await this.repository.deleteDraft(user.id);
      return null;
    }
    const current = await this.repository.getDraft(user.id);
    const base: Omit<MarketplaceDraftRow, 'updated_at'> = current
      ? {
          additional_details: current.additional_details,
          description: current.description,
          region: current.region,
          specialization_code: current.specialization_code,
          step: current.step,
          user_id: current.user_id,
          language: current.language,
        }
      : {
          additional_details: null,
          description: null,
          region: null,
          specialization_code: null,
          step: 'specialization',
          user_id: user.id,
          language: (user.language as Language | null) ?? 'uz',
        };
    if (action.action === 'start') base.step = 'specialization';
    if (action.action === 'set_specialization') {
      base.specialization_code = action.specializationCode;
      base.step = 'description';
    }
    if (action.action === 'set_description') {
      base.description = action.description;
      base.step = 'region';
    }
    if (action.action === 'set_region') {
      base.region = action.region;
      base.step = 'additional_details';
    }
    if (action.action === 'set_additional_details') {
      base.additional_details = action.additionalDetails;
      base.step = 'preview';
    }
    if (action.action === 'back') {
      const previous = {
        additional_details: 'region',
        description: 'specialization',
        preview: 'additional_details',
        region: 'description',
        specialization: 'specialization',
      } as const;
      base.step = previous[base.step];
    }
    return draftView(await this.repository.saveDraft(base));
  }

  async getDraft(userId: string): Promise<MarketplaceDraftView | null> {
    const row = await this.repository.getDraft(userId);
    return row ? draftView(row) : null;
  }

  async confirmDraft(
    user: UserRow,
    idempotencyKey: string,
    language: Language,
  ): Promise<MarketplacePostView> {
    const draft = await this.repository.getDraft(user.id);
    if (!draft?.specialization_code || !draft.description || draft.step !== 'preview')
      throw new AppError(400, 'VALIDATION_ERROR', 'Marketplace draft is incomplete');
    try {
      const now = this.now();
      return postView(
        await this.repository.createPost({
          additionalDetails: draft.additional_details,
          description: draft.description,
          expiresAt: new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 86_400_000),
          idempotencyKey,
          now,
          region: draft.region,
          specializationCode: draft.specialization_code,
          userId: user.id,
          language,
        }),
        language,
      );
    } catch (error) {
      marketplaceError(error);
    }
  }

  async create(
    user: UserRow,
    input: {
      specializationCode: string;
      description: string;
      region?: string | undefined;
      additionalDetails?: string | undefined;
      idempotencyKey: string;
    },
    language: Language,
  ): Promise<MarketplacePostView> {
    try {
      const now = this.now();
      return postView(
        await this.repository.createPost({
          additionalDetails: input.additionalDetails ?? null,
          description: input.description,
          expiresAt: new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 86_400_000),
          idempotencyKey: input.idempotencyKey,
          now,
          region: input.region ?? null,
          specializationCode: input.specializationCode,
          userId: user.id,
          language,
        }),
        language,
      );
    } catch (error) {
      marketplaceError(error);
    }
  }

  async listOwn(userId: string, language: Language): Promise<MarketplacePostView[]> {
    await this.repository.expirePosts(this.now());
    return (await this.repository.listOwnedPosts(userId)).map((row) => postView(row, language));
  }

  async getOwn(postId: string, userId: string, language: Language): Promise<MarketplacePostView> {
    const row = await this.repository.findOwnedPost(postId, userId);
    if (!row)
      throw new AppError(404, 'MARKETPLACE_POST_NOT_FOUND', 'Marketplace request not found');
    return postView(row, language);
  }

  async publicContext(identifier: string, language: Language): Promise<MarketplacePostView> {
    await this.repository.expirePosts(this.now());
    const row = await this.repository.findPublicPost(identifier);
    if (!row)
      throw new AppError(404, 'MARKETPLACE_POST_NOT_FOUND', 'Marketplace request not found');
    return postView(row, language);
  }

  async publicListing(identifier: string, language: Language) {
    const post = await this.publicContext(identifier, language);
    return {
      acceptanceCount: post.acceptanceCount,
      additionalDetails: post.additionalDetails,
      createdAt: post.createdAt,
      description: post.description,
      expiresAt: post.expiresAt,
      maxAcceptances: post.maxAcceptances,
      publicIdentifier: post.publicIdentifier,
      region: post.region,
      specializationCode: post.specializationCode,
      specializationName: post.specializationName,
      status: post.status,
    };
  }

  async recordChannelMessage(postId: string, messageId: number): Promise<void> {
    await this.repository.setChannelMessage(postId, messageId);
  }

  async recordChannelFailure(postId: string): Promise<void> {
    await this.repository.recordPublicationFailure(postId);
  }

  async accept(user: UserRow, identifier: string) {
    try {
      await this.repository.expirePosts(this.now());
      const result = await this.repository.acceptPost(identifier, user.id, this.now());
      return {
        ...result,
        ownerTelegramId: await this.repository.getOwnerTelegramId(result.postId),
      };
    } catch (error) {
      marketplaceError(error);
    }
  }

  async acceptances(
    postId: string,
    ownerId: string,
    language: Language,
  ): Promise<MarketplaceAcceptanceView[]> {
    const rows = await this.repository.listPostAcceptances(postId, ownerId);
    return rows.map((row) => ({
      acceptedAt: row.accepted_at,
      id: row.id,
      lawyer: {
        duid: row.duid,
        fullName: row.full_name,
        publicSlug: row.public_slug,
        ratingAverage: row.rating_average,
        ratingCount: row.rating_count,
        region: row.region,
        specializations: row.specializations.map((item) => ({
          code: item.code,
          id: item.code,
          name: item[`name_${language}`],
        })),
        verified: true,
      },
      status: row.status,
    }));
  }

  async select(userId: string, postId: string, acceptanceId: string) {
    try {
      const result = await this.repository.selectLawyer({
        acceptanceId,
        now: this.now(),
        postId,
        userId,
      });
      return {
        ...result,
        acceptedLawyerTelegramIds: await this.repository.getAcceptedLawyerTelegramIds(postId),
        selectedLawyerTelegramId: await this.repository.getLawyerTelegramId(result.lawyerId),
      };
    } catch (error) {
      marketplaceError(error);
    }
  }

  async cancel(userId: string, postId: string, language: Language) {
    try {
      const participantTelegramIds = await this.repository.getAcceptedLawyerTelegramIds(postId);
      const post = await this.repository.cancelPost(postId, userId, this.now());
      return { participantTelegramIds, post: postView(post, language) };
    } catch (error) {
      marketplaceError(error);
    }
  }

  async review(
    userId: string,
    input: { postId: string; rating: number; comment?: string | undefined },
  ) {
    try {
      const review = await this.repository.createReview({
        comment: input.comment ?? null,
        now: this.now(),
        postId: input.postId,
        rating: input.rating,
        userId,
      });
      return {
        comment: review.comment,
        createdAt: review.created_at,
        id: review.id,
        rating: review.rating,
      };
    } catch (error) {
      marketplaceError(error);
    }
  }

  async lawyerDashboard(userId: string, language: Language) {
    await this.repository.expirePosts(this.now());
    const items = (await this.repository.listLawyerAcceptances(userId)).map((row) =>
      postView(row, language),
    );
    return {
      accepted: items.filter((item) => item.status === 'open').length,
      closed: items.filter((item) => item.status !== 'open').length,
      items,
      selected: items.filter((item) => item.status === 'selected').length,
    };
  }
}
