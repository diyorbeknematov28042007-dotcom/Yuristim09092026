import type { MarketplacePostRow, MarketplaceRepository, UserRow } from '@yuristim/db';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors.js';
import { MarketplaceService } from './service.js';

const now = new Date('2026-09-16T12:00:00.000Z');
const user = { id: '10000000-0000-4000-8000-000000000001', language: 'uz' } as UserRow;

function post(overrides: Partial<MarketplacePostRow> = {}): MarketplacePostRow {
  return {
    acceptance_count: 0,
    additional_details: null,
    cancelled_at: null,
    created_at: now.toISOString(),
    description: 'Mehnat shartnomasi bo‘yicha huquqiy muammo tavsifi.',
    expires_at: '2026-09-30T12:00:00.000Z',
    id: '20000000-0000-4000-8000-000000000001',
    max_acceptances: 5,
    public_identifier: 'mp_1234567890abcdef12345678',
    region: 'Toshkent',
    selected_acceptance_id: null,
    selected_at: null,
    specialization_code: 'labor',
    specialization_id: '30000000-0000-4000-8000-000000000001',
    specialization_name_en: 'Labor law',
    specialization_name_ru: 'Трудовое право',
    specialization_name_uz: 'Mehnat huquqi',
    status: 'open',
    telegram_channel_message_id: null,
    updated_at: now.toISOString(),
    user_id: user.id,
    ...overrides,
  };
}

function repository(overrides: Partial<MarketplaceRepository> = {}): MarketplaceRepository {
  return {
    acceptPost: vi.fn(),
    cancelPost: vi.fn(),
    createPost: vi.fn().mockResolvedValue(post()),
    createReview: vi.fn(),
    deleteDraft: vi.fn(),
    expirePosts: vi.fn().mockResolvedValue(0),
    findOwnedPost: vi.fn(),
    findPublicPost: vi.fn(),
    getAcceptedLawyerTelegramIds: vi.fn().mockResolvedValue([]),
    getDraft: vi.fn(),
    getLawyerTelegramId: vi.fn(),
    getOwnerTelegramId: vi.fn(),
    listLawyerAcceptances: vi.fn().mockResolvedValue([]),
    listOwnedPosts: vi.fn().mockResolvedValue([]),
    listPostAcceptances: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn(),
    selectLawyer: vi.fn(),
    setChannelMessage: vi.fn(),
    ...overrides,
  };
}

describe('MarketplaceService', () => {
  it('creates an anonymized post from a complete persistent draft', async () => {
    const repo = repository({
      getDraft: vi.fn().mockResolvedValue({
        additional_details: null,
        description: post().description,
        region: 'Toshkent',
        specialization_code: 'labor',
        step: 'preview',
        updated_at: now.toISOString(),
        user_id: user.id,
      }),
    });
    const service = new MarketplaceService(repo, () => now);
    const result = await service.confirmDraft(user, 'telegram:request-1', 'uz');

    expect(result.publicIdentifier).toMatch(/^mp_/);
    expect(result.specializationName).toBe('Mehnat huquqi');
    expect(repo.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'telegram:request-1', userId: user.id }),
    );
    expect(JSON.stringify(result)).not.toContain(user.id);
  });

  it('rejects an incomplete draft before creating a post', async () => {
    const repo = repository({ getDraft: vi.fn().mockResolvedValue(null) });
    const service = new MarketplaceService(repo, () => now);
    await expect(service.confirmDraft(user, 'telegram:request-2', 'uz')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(repo.createPost).not.toHaveBeenCalled();
  });

  it.each([
    ['P0001', 'INSUFFICIENT_ACCEPT_BALANCE'],
    ['54000', 'MARKETPLACE_CAPACITY_REACHED'],
    ['55000', 'MARKETPLACE_POST_CLOSED'],
  ])('maps atomic accept database error %s', async (databaseCode, expectedCode) => {
    const error = Object.assign(new Error('database rejection'), { databaseCode });
    const repo = repository({ acceptPost: vi.fn().mockRejectedValue(error) });
    const service = new MarketplaceService(repo, () => now);
    await expect(service.accept(user, post().public_identifier)).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  it('returns only public lawyer fields to the request owner', async () => {
    const repo = repository({
      listPostAcceptances: vi.fn().mockResolvedValue([
        {
          accepted_at: now.toISOString(),
          duid: 'yr_publiclawyer01',
          full_name: 'Verified Lawyer',
          id: 'ma_1234567890abcdef1234',
          lawyer_id: 'private-lawyer-id',
          marketplace_post_id: post().id,
          public_slug: 'verified-lawyer',
          rating_average: 4.8,
          rating_count: 12,
          region: 'Toshkent',
          selected_at: null,
          specializations: [
            {
              code: 'labor',
              name_en: 'Labor law',
              name_ru: 'Трудовое право',
              name_uz: 'Mehnat huquqi',
            },
          ],
          status: 'accepted',
        },
      ]),
    });
    const service = new MarketplaceService(repo, () => now);
    const result = await service.acceptances(post().id, user.id, 'uz');
    expect(result[0]?.lawyer).toMatchObject({ fullName: 'Verified Lawyer', verified: true });
    expect(JSON.stringify(result)).not.toContain('private-lawyer-id');
  });

  it('preserves known application errors', async () => {
    const expected = new AppError(409, 'MARKETPLACE_POST_CLOSED', 'closed');
    const repo = repository({ cancelPost: vi.fn().mockRejectedValue(expected) });
    const service = new MarketplaceService(repo, () => now);
    await expect(service.cancel(user.id, post().id, 'uz')).rejects.toBe(expected);
  });
});
