import { randomUUID } from 'node:crypto';
import {
  jsonObject,
  type Json,
  type LawyerProfileRecord,
  type LawyerRepository,
  type LawyerVerificationRow,
  type UserRow,
} from '@yuristim/db';
import type {
  BotLawyerContext,
  BotVerificationAction,
  Language,
  LawyerProfileView,
  LawyerVerificationDraft,
  LawyerVerificationView,
  SpecializationView,
  VerificationType,
} from '@yuristim/types';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PROFILE_URL_SECONDS = 15 * 60;

const completeDraftSchema = z.object({
  bio: z.string().trim().min(20).max(1000),
  consultationPrice: z.number().min(0).max(1_000_000_000).nullable().optional(),
  experienceYears: z.number().int().min(0).max(70),
  fullName: z.string().trim().min(2).max(160),
  profileImagePath: z.string().min(1).max(512),
  region: z.string().trim().min(2).max(120),
  specializationCodes: z.array(z.string().min(2).max(64)).min(1).max(24),
  verificationDocumentPaths: z.array(z.string().min(1).max(512)).min(1).max(10),
});

const steps: NonNullable<LawyerVerificationDraft['step']>[] = [
  'full_name',
  'region',
  'specializations',
  'experience',
  'bio',
  'price',
  'profile_image',
  'verification_document',
  'summary',
];

function draftFrom(row: LawyerVerificationRow): LawyerVerificationDraft {
  return jsonObject(row.submitted_data as Json) as LawyerVerificationDraft;
}

function specializationView(
  row: { id: string; code: string; name_uz: string; name_ru: string; name_en: string },
  language: Language,
): SpecializationView {
  return { code: row.code, id: row.id, name: row[`name_${language}`] };
}

function extensionFor(contentType: string): string {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'image/png') return 'png';
  return 'jpg';
}

function validMagic(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === 'application/pdf')
    return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-';
  if (contentType === 'image/jpeg')
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png')
    return (
      bytes.length >= 8 &&
      Buffer.from(bytes.subarray(0, 8)).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    );
  return false;
}

function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Verification input is invalid');
  return parsed.data;
}

export class LawyerService {
  constructor(
    private readonly repository: LawyerRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async apply(user: UserRow): Promise<LawyerProfileView> {
    const existing = await this.repository.findProfileByUserId(user.id);
    const record = existing ?? (await this.repository.createProfile(user.id, user.duid));
    return this.toProfileView(record, user.language as Language | null);
  }

  async listSpecializations(language: Language): Promise<SpecializationView[]> {
    return (await this.repository.listSpecializations()).map((item) =>
      specializationView(item, language),
    );
  }

  async getOwn(user: UserRow): Promise<LawyerProfileView> {
    const record = await this.repository.findProfileByUserId(user.id);
    if (!record) throw new AppError(404, 'LAWYER_PROFILE_NOT_FOUND', 'Lawyer profile not found');
    return this.toProfileView(record, user.language as Language | null);
  }

  async getPublic(duid: string, language: Language): Promise<LawyerProfileView> {
    const record = await this.repository.findApprovedProfileByDuid(duid);
    if (!record) throw new AppError(404, 'NOT_FOUND', 'Lawyer profile not found');
    return this.toProfileView(record, language);
  }

  async search(input: Parameters<LawyerRepository['searchApproved']>[0], language: Language) {
    const result = await this.repository.searchApproved(input);
    return {
      items: await Promise.all(result.items.map((item) => this.toProfileView(item, language))),
      limit: input.limit,
      page: input.page,
      total: result.total,
    };
  }

  async getVerification(user: UserRow): Promise<LawyerVerificationView | null> {
    const profile = await this.repository.findProfileByUserId(user.id);
    if (!profile) return null;
    const verification = await this.repository.findLatestVerification(profile.profile.id);
    return verification ? this.toVerificationView(verification) : null;
  }

  async getBotContext(user: UserRow): Promise<BotLawyerContext> {
    const profile = await this.repository.findProfileByUserId(user.id);
    return {
      profile: profile ? await this.toProfileView(profile, user.language as Language | null) : null,
      specializations: await this.listSpecializations((user.language as Language | null) ?? 'uz'),
      verification: profile
        ? await this.repository
            .findLatestVerification(profile.profile.id)
            .then((row) => (row ? this.toVerificationView(row) : null))
        : null,
    };
  }

  async startDraft(
    user: UserRow,
    type: VerificationType = 'initial',
  ): Promise<LawyerVerificationView> {
    const profile = await this.ensureProfile(user);
    const open = await this.repository.findOpenVerification(profile.profile.id);
    if (open) {
      if (open.status !== 'draft')
        throw new AppError(409, 'VERIFICATION_ALREADY_PENDING', 'Verification is already pending');
      return this.toVerificationView(open);
    }
    if (type === 'profile_update' && profile.profile.verification_status !== 'approved') {
      throw new AppError(409, 'LAWYER_NOT_VERIFIED', 'Approved lawyer profile is required');
    }
    const initialDraft: LawyerVerificationDraft = {
      fullName: user.full_name ?? undefined,
      step: 'full_name',
    };
    return this.toVerificationView(
      await this.repository.createVerification({
        lawyerId: profile.profile.id,
        now: this.now(),
        submittedData: initialDraft as Json,
        type,
      }),
    );
  }

  async updateDraft(
    user: UserRow,
    action: BotVerificationAction,
  ): Promise<LawyerVerificationView | null> {
    if (action.action === 'start') return this.startDraft(user, action.type);
    const profile = await this.ensureProfile(user);
    const row = await this.repository.findOpenVerification(profile.profile.id);
    if (!row || row.status !== 'draft')
      throw new AppError(404, 'VERIFICATION_NOT_FOUND', 'Verification draft not found');
    if (action.action === 'cancel') {
      await this.repository.cancelDraft(row.id);
      return null;
    }

    const draft = draftFrom(row);
    switch (action.action) {
      case 'set_full_name':
        draft.fullName = validated(z.string().trim().min(2).max(160), action.fullName);
        draft.step = 'region';
        break;
      case 'set_region':
        draft.region = validated(z.string().trim().min(2).max(120), action.region);
        draft.step = 'specializations';
        break;
      case 'toggle_specialization': {
        const valid = await this.repository.findSpecializationsByCodes([action.code]);
        if (valid.length !== 1)
          throw new AppError(400, 'INVALID_SPECIALIZATION', 'Specialization is invalid');
        const selected = new Set(draft.specializationCodes ?? []);
        if (selected.has(action.code)) selected.delete(action.code);
        else selected.add(action.code);
        draft.specializationCodes = [...selected];
        break;
      }
      case 'finish_specializations':
        if (!draft.specializationCodes?.length)
          throw new AppError(400, 'INVALID_SPECIALIZATION', 'Select at least one specialization');
        draft.step = 'experience';
        break;
      case 'set_experience':
        draft.experienceYears = validated(z.number().int().min(0).max(70), action.experienceYears);
        draft.step = 'bio';
        break;
      case 'set_bio':
        draft.bio = validated(z.string().trim().min(20).max(1000), action.bio);
        draft.step = 'price';
        break;
      case 'set_price':
        draft.consultationPrice = validated(
          z.number().min(0).max(1_000_000_000).nullable(),
          action.consultationPrice,
        );
        draft.step = 'profile_image';
        break;
      case 'set_profile_image':
        draft.profileImagePath = validated(z.string().min(1).max(512), action.path);
        draft.step = 'verification_document';
        break;
      case 'add_verification_document':
        draft.verificationDocumentPaths = [
          ...new Set([...(draft.verificationDocumentPaths ?? []), action.path]),
        ];
        draft.step = 'summary';
        break;
      case 'back': {
        const index = steps.indexOf(draft.step ?? 'full_name');
        draft.step = steps[Math.max(0, index - 1)];
        break;
      }
      case 'submit':
        return this.submitDraft(row, draft);
    }
    return this.toVerificationView(await this.repository.updateDraft(row.id, draft as Json));
  }

  async submit(user: UserRow, input: LawyerVerificationDraft): Promise<LawyerVerificationView> {
    const profile = await this.ensureProfile(user);
    const open = await this.repository.findOpenVerification(profile.profile.id);
    if (open && open.status !== 'draft')
      throw new AppError(409, 'VERIFICATION_ALREADY_PENDING', 'Verification is already pending');
    const row =
      open ??
      (await this.repository.createVerification({
        lawyerId: profile.profile.id,
        now: this.now(),
        submittedData: input as Json,
        type: profile.profile.verification_status === 'approved' ? 'profile_update' : 'initial',
      }));
    return this.submitDraft(row, input);
  }

  async requestProfileChange(
    user: UserRow,
    input: Partial<LawyerVerificationDraft>,
  ): Promise<LawyerVerificationView> {
    const profile = await this.repository.findProfileByUserId(user.id);
    if (!profile || profile.profile.verification_status !== 'approved')
      throw new AppError(409, 'LAWYER_NOT_VERIFIED', 'Approved lawyer profile is required');
    const open = await this.repository.findOpenVerification(profile.profile.id);
    if (!open || open.status !== 'draft' || open.type !== 'profile_update')
      throw new AppError(404, 'VERIFICATION_NOT_FOUND', 'Profile change draft not found');
    const currentDraft = draftFrom(open);
    const merged: LawyerVerificationDraft = {
      bio: profile.profile.bio ?? undefined,
      consultationPrice: profile.profile.consultation_price,
      experienceYears: profile.profile.experience_years ?? undefined,
      fullName: profile.user.full_name ?? undefined,
      profileImagePath: profile.profile.profile_image_path ?? undefined,
      region: profile.profile.region ?? undefined,
      specializationCodes: profile.specializations.map((item) => item.code),
      ...currentDraft,
      ...input,
    };
    return this.submitDraft(open, merged);
  }

  async uploadFile(
    user: UserRow,
    input: {
      base64: string;
      contentType: string;
      kind: 'profile_image' | 'verification_document';
      originalFilename: string;
    },
  ): Promise<{ path: string }> {
    const profile = await this.ensureProfile(user);
    const verification = await this.repository.findOpenVerification(profile.profile.id);
    if (!verification || verification.status !== 'draft')
      throw new AppError(404, 'VERIFICATION_NOT_FOUND', 'Verification draft not found');
    if (
      !['application/pdf', 'image/jpeg', 'image/png'].includes(input.contentType) ||
      (input.kind === 'profile_image' && input.contentType === 'application/pdf')
    ) {
      throw new AppError(400, 'INVALID_VERIFICATION_FILE', 'File type is not allowed');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64) || input.base64.length % 4 !== 0)
      throw new AppError(400, 'INVALID_VERIFICATION_FILE', 'File encoding is invalid');
    const bytes: Uint8Array = Buffer.from(input.base64, 'base64');
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_FILE_BYTES ||
      !validMagic(bytes, input.contentType)
    ) {
      throw new AppError(400, 'INVALID_VERIFICATION_FILE', 'File content is invalid');
    }
    const path = `${profile.profile.id}/${verification.id}/${randomUUID()}.${extensionFor(input.contentType)}`;
    await this.repository.addVerificationDocument({
      bytes,
      contentType: input.contentType as 'application/pdf' | 'image/jpeg' | 'image/png',
      kind: input.kind,
      originalFilename: input.originalFilename.slice(0, 255),
      storagePath: path,
      verificationId: verification.id,
    });
    await this.updateDraft(
      user,
      input.kind === 'profile_image'
        ? { action: 'set_profile_image', path }
        : { action: 'add_verification_document', path },
    );
    return { path };
  }

  private async submitDraft(
    row: LawyerVerificationRow,
    draft: LawyerVerificationDraft,
  ): Promise<LawyerVerificationView> {
    const parsed = await this.validateCompleteDraft(draft, row.id);
    const submitted = await this.repository.submitDraft(row.id, parsed as Json, this.now());
    if (!submitted)
      throw new AppError(409, 'VERIFICATION_ALREADY_PENDING', 'Verification is already submitted');
    return this.toVerificationView(submitted);
  }

  private async validateCompleteDraft(
    draft: LawyerVerificationDraft,
    verificationId?: string,
  ): Promise<LawyerVerificationDraft> {
    const parsed = completeDraftSchema.safeParse(draft);
    if (!parsed.success)
      throw new AppError(400, 'VALIDATION_ERROR', 'Verification profile is incomplete');
    const uniqueCodes = [...new Set(parsed.data.specializationCodes)];
    const valid = await this.repository.findSpecializationsByCodes(uniqueCodes);
    if (valid.length !== uniqueCodes.length)
      throw new AppError(400, 'INVALID_SPECIALIZATION', 'Specialization is invalid');
    if (verificationId) {
      const documents = await this.repository.listVerificationDocuments(verificationId);
      const profileImage = documents.some(
        (document) =>
          document.kind === 'profile_image' &&
          document.storage_path === parsed.data.profileImagePath,
      );
      const verificationPaths = new Set(
        documents
          .filter((document) => document.kind === 'verification_document')
          .map((document) => document.storage_path),
      );
      if (
        !profileImage ||
        !parsed.data.verificationDocumentPaths.every((path) => verificationPaths.has(path))
      ) {
        throw new AppError(
          400,
          'INVALID_VERIFICATION_FILE',
          'Verification files do not belong to this request',
        );
      }
    }
    return { ...parsed.data, specializationCodes: uniqueCodes, step: 'summary' };
  }

  private async ensureProfile(user: UserRow): Promise<LawyerProfileRecord> {
    return (
      (await this.repository.findProfileByUserId(user.id)) ??
      this.repository.createProfile(user.id, user.duid)
    );
  }

  private async toProfileView(
    record: LawyerProfileRecord,
    language: Language | null,
  ): Promise<LawyerProfileView> {
    const profile = record.profile;
    return {
      bio: profile.bio,
      consultationPrice: profile.consultation_price,
      createdAt: profile.created_at,
      currency: 'UZS',
      duid: record.user.duid,
      experienceYears: profile.experience_years,
      fullName: record.user.full_name,
      id: profile.id,
      jobsCount: profile.jobs_count,
      profileImageUrl: profile.profile_image_path
        ? await this.repository.createSignedUrl(
            'profile-images',
            profile.profile_image_path,
            PROFILE_URL_SECONDS,
          )
        : null,
      publicSlug: profile.public_slug,
      ratingAverage: profile.rating_average,
      ratingCount: profile.rating_count,
      region: profile.region,
      specializations: record.specializations.map((item) =>
        specializationView(item, language ?? 'uz'),
      ),
      telegramUsername: record.user.telegram_username,
      verificationStatus: profile.verification_status as LawyerProfileView['verificationStatus'],
      verifiedAt: profile.verified_at,
    };
  }

  private toVerificationView(row: LawyerVerificationRow): LawyerVerificationView {
    return {
      draft: draftFrom(row),
      id: row.id,
      rejectReason: row.status === 'rejected' ? row.reject_reason : null,
      reviewedAt: row.reviewed_at,
      status: row.status as LawyerVerificationView['status'],
      submittedAt: row.submitted_at,
      type: row.type as VerificationType,
    };
  }
}
