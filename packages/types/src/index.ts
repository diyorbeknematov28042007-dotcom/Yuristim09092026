export type ServiceStatus = 'ok' | 'ready';

export interface ServiceHealthResponse {
  status: ServiceStatus;
  service: string;
  requestId: string;
}

export const LANGUAGES = ['uz', 'ru', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const USER_ROLES = ['user', 'lawyer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_MODES = ['user', 'lawyer'] as const;
export type UserMode = (typeof USER_MODES)[number];

export type UserStatus = 'active' | 'blocked';
export type OnboardingStatus =
  'language_selection' | 'role_selection' | 'name_required' | 'terms_acceptance' | 'completed';

export interface UserView {
  id: string;
  telegramUserId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  fullName: string | null;
  language: Language | null;
  activeMode: UserMode;
  onboardingRole: UserRole | null;
  onboardingStatus: OnboardingStatus;
  duid: string;
  status: UserStatus;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotUserContext {
  hasPin: boolean;
  user: UserView;
}

export type BotOnboardingAction =
  | { action: 'set_language'; language: Language }
  | { action: 'set_role'; role: UserRole }
  | { action: 'set_full_name'; fullName: string }
  | { action: 'accept_terms'; termsVersion: string }
  | { action: 'reset' };

export interface UserTagView {
  id: string;
  tag: string;
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  createdAt: string;
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'USER_BLOCKED'
  | 'INVALID_PIN'
  | 'PIN_TEMPORARILY_LOCKED'
  | 'INVALID_LOGIN_CHALLENGE'
  | 'LOGIN_CHALLENGE_EXPIRED'
  | 'LAWYER_NOT_VERIFIED'
  | 'LAWYER_PROFILE_NOT_FOUND'
  | 'LAWYER_ALREADY_EXISTS'
  | 'VERIFICATION_ALREADY_PENDING'
  | 'VERIFICATION_NOT_FOUND'
  | 'VERIFICATION_ALREADY_REVIEWED'
  | 'VERIFICATION_REJECT_REASON_REQUIRED'
  | 'INVALID_SPECIALIZATION'
  | 'INVALID_VERIFICATION_FILE'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
  requestId: string;
}

export const LAWYER_VERIFICATION_STATUSES = [
  'unverified',
  'draft',
  'submitted',
  'pending_review',
  'approved',
  'rejected',
  'resubmitted',
] as const;
export type LawyerVerificationStatus = (typeof LAWYER_VERIFICATION_STATUSES)[number];

export const VERIFICATION_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'pending_review',
  'approved',
  'rejected',
] as const;
export type VerificationRequestStatus = (typeof VERIFICATION_REQUEST_STATUSES)[number];
export type VerificationType = 'initial' | 'profile_update';

export interface SpecializationView {
  id: string;
  code: string;
  name: string;
}

export interface LawyerVerificationDraft {
  step?:
    | 'full_name'
    | 'region'
    | 'specializations'
    | 'experience'
    | 'bio'
    | 'price'
    | 'profile_image'
    | 'verification_document'
    | 'summary'
    | undefined;
  fullName?: string | undefined;
  region?: string | undefined;
  specializationCodes?: string[] | undefined;
  experienceYears?: number | undefined;
  bio?: string | undefined;
  consultationPrice?: number | null | undefined;
  profileImagePath?: string | undefined;
  verificationDocumentPaths?: string[] | undefined;
}

export interface LawyerVerificationView {
  id: string;
  type: VerificationType;
  status: VerificationRequestStatus;
  draft: LawyerVerificationDraft;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}

export interface LawyerProfileView {
  id: string;
  duid: string;
  publicSlug: string;
  verificationStatus: LawyerVerificationStatus;
  fullName: string | null;
  telegramUsername: string | null;
  region: string | null;
  specializations: SpecializationView[];
  experienceYears: number | null;
  bio: string | null;
  consultationPrice: number | null;
  currency: 'UZS';
  profileImageUrl: string | null;
  ratingAverage: number;
  ratingCount: number;
  jobsCount: number;
  verifiedAt: string | null;
  createdAt: string;
}

export interface BotLawyerContext {
  profile: LawyerProfileView | null;
  verification: LawyerVerificationView | null;
  specializations: SpecializationView[];
}

export type BotVerificationAction =
  | { action: 'start'; type?: VerificationType | undefined }
  | { action: 'set_full_name'; fullName: string }
  | { action: 'set_region'; region: string }
  | { action: 'toggle_specialization'; code: string }
  | { action: 'finish_specializations' }
  | { action: 'set_experience'; experienceYears: number }
  | { action: 'set_bio'; bio: string }
  | { action: 'set_price'; consultationPrice: number | null }
  | { action: 'set_profile_image'; path: string }
  | { action: 'add_verification_document'; path: string }
  | { action: 'back' }
  | { action: 'cancel' }
  | { action: 'submit' };

export interface AdminView {
  id: string;
  username: string;
  role: 'admin' | 'support';
  status: 'active' | 'blocked';
}
