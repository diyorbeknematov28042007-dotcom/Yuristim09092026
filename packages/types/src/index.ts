export type ServiceStatus = 'ok' | 'ready';

export interface ServiceHealthResponse {
  status: ServiceStatus;
  service: string;
  requestId: string;
  dependencies?: {
    ai: Record<'fast' | 'expert', boolean>;
  };
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
  | 'INSUFFICIENT_CREDITS'
  | 'INVALID_CREDIT_PRODUCT'
  | 'CREDIT_PRODUCT_INACTIVE'
  | 'INVALID_ACCEPT_PRODUCT'
  | 'ACCEPT_PRODUCT_INACTIVE'
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_ALREADY_PROCESSED'
  | 'PAYMENT_VERIFICATION_FAILED'
  | 'INVALID_PAYMENT_STATE'
  | 'MARKETPLACE_POST_NOT_FOUND'
  | 'MARKETPLACE_POST_CLOSED'
  | 'MARKETPLACE_CAPACITY_REACHED'
  | 'MARKETPLACE_ALREADY_ACCEPTED'
  | 'MARKETPLACE_OWNER_CANNOT_ACCEPT'
  | 'MARKETPLACE_FORBIDDEN'
  | 'MARKETPLACE_ACCEPTANCE_NOT_FOUND'
  | 'MARKETPLACE_REVIEW_NOT_ALLOWED'
  | 'INSUFFICIENT_ACCEPT_BALANCE'
  | 'AI_CONVERSATION_NOT_FOUND'
  | 'AI_CONVERSATION_BUSY'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_PROVIDER_RATE_LIMIT'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_NOT_CONFIGURED'
  | 'AI_REQUEST_CANCELLED'
  | 'AI_DELIVERY_FAILED'
  | 'FOUNDING100_FULL'
  | 'FOUNDING100_RESERVATION_NOT_FOUND'
  | 'FOUNDING100_RESERVATION_EXPIRED'
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

export const CREDIT_TRANSACTION_TYPES = [
  'purchase',
  'welcome_bonus',
  'weekly_bonus',
  'student_bonus',
  'admin_bonus',
  'ai_usage',
  'document_usage',
  'refund',
  'adjustment',
  'reversal',
] as const;
export type CreditTransactionType = (typeof CREDIT_TRANSACTION_TYPES)[number];

export const CREDIT_BUCKET_TYPES = ['paid', 'weekly', 'bonus'] as const;
export type CreditBucketType = (typeof CREDIT_BUCKET_TYPES)[number];

export interface CreditBalanceView {
  total: number;
  paid: number;
  weekly: number;
  bonus: number;
  nextExpiry: string | null;
  lowBalance: boolean;
  zeroBalance: boolean;
}

export interface CreditTransactionView {
  id: string;
  type: CreditTransactionType;
  bucketType: CreditBucketType;
  amount: number;
  balanceAfter: number;
  expiresAt: string | null;
  reason: string | null;
  createdAt: string;
}

export interface CreditTransactionPage {
  items: CreditTransactionView[];
  page: number;
  limit: number;
  total: number;
}

export interface CreditProductView {
  id: string;
  code: string;
  name: string;
  creditAmount: number;
  price: number;
  currency: 'UZS';
}

export interface MarketplaceAcceptBalanceView {
  balance: number;
  nextExpiry: string | null;
}

export interface MarketplaceAcceptProductView {
  id: string;
  code: string;
  name: string;
  acceptCount: number;
  price: number;
  currency: 'UZS';
  expiresInDays: number | null;
}

export const PAYMENT_PRODUCT_TYPES = ['credits', 'marketplace_accepts', 'profile_tariff'] as const;
export type PaymentProductType = (typeof PAYMENT_PRODUCT_TYPES)[number];
export const PAYMENT_STATUSES = ['created', 'pending', 'paid', 'failed', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface PaymentView {
  id: string;
  provider: string;
  providerPaymentId: string | null;
  productType: PaymentProductType;
  productId: string;
  productCode: string;
  productUnits: number;
  amountMoney: number;
  currency: 'UZS';
  status: PaymentStatus;
  checkoutUrl: string | null;
  createdAt: string;
  paidAt: string | null;
  failedAt: string | null;
}

export const MARKETPLACE_POST_STATUSES = [
  'draft',
  'open',
  'selected',
  'cancelled',
  'expired',
] as const;
export type MarketplacePostStatus = (typeof MARKETPLACE_POST_STATUSES)[number];

export interface MarketplacePostView {
  id: string;
  publicIdentifier: string;
  specializationCode: string;
  specializationName: string;
  description: string;
  region: string | null;
  additionalDetails: string | null;
  status: MarketplacePostStatus;
  acceptanceCount: number;
  maxAcceptances: number;
  selectedAcceptanceId: string | null;
  telegramChannelMessageId: number | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface MarketplaceAcceptanceView {
  id: string;
  status: 'accepted' | 'selected' | 'not_selected' | 'cancelled';
  acceptedAt: string;
  lawyer: {
    fullName: string;
    duid: string;
    publicSlug: string;
    region: string | null;
    ratingAverage: number;
    ratingCount: number;
    specializations: SpecializationView[];
    verified: true;
  };
}

export interface MarketplaceDraftView {
  specializationCode: string | null;
  description: string | null;
  region: string | null;
  additionalDetails: string | null;
  step: 'specialization' | 'description' | 'region' | 'additional_details' | 'preview';
}

export type BotMarketplaceDraftAction =
  | { action: 'start' }
  | { action: 'set_specialization'; specializationCode: string }
  | { action: 'set_description'; description: string }
  | { action: 'set_region'; region: string | null }
  | { action: 'set_additional_details'; additionalDetails: string | null }
  | { action: 'back' }
  | { action: 'cancel' };

export const AI_MODES = ['fast', 'expert'] as const;
export type AiMode = (typeof AI_MODES)[number];

export const AI_MESSAGE_STATUSES = [
  'pending',
  'running',
  'streaming',
  'completed',
  'failed',
  'cancelled',
] as const;
export type AiMessageStatus = (typeof AI_MESSAGE_STATUSES)[number];

export interface AiConversationView {
  id: string;
  title: string;
  mode: AiMode;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

export interface AiMessageSourceView {
  title: string;
  url: string;
  sourceType: 'official_legal' | 'official_government' | 'court' | 'secondary' | 'other';
  publisher: string | null;
  domain: string | null;
  citationOrder: number;
  official: boolean;
  verified: boolean;
}

export interface AiMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: AiMode;
  status: AiMessageStatus;
  chargedCredits: number;
  sourceStatus: 'none' | 'available' | 'unverified';
  sources: AiMessageSourceView[];
  createdAt: string;
  completedAt: string | null;
}

export interface AiEstimateView {
  mode: AiMode;
  estimatedCredits: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  sufficientBalance: boolean;
  currentBalance: number;
}

export interface AiSendResult {
  conversation: AiConversationView;
  message: AiMessageView;
  duplicate: boolean;
}

export interface AiStatusView {
  mode: AiMode;
  activeConversationId: string | null;
  botChatActive: boolean;
  availability: Record<AiMode, boolean>;
  balance: CreditBalanceView;
}

export interface BotRuntimeUserView {
  activeMode: UserMode;
  language: Language | null;
  onboardingRole: UserRole | null;
  onboardingStatus: OnboardingStatus;
}

export interface BotAiRuntimeView {
  activeConversationId: string | null;
  botChatActive: boolean;
  mode: AiMode;
  telegramControlMessageId: number | null;
}

export interface BotRuntimeContext {
  user: BotRuntimeUserView;
  lawyer: {
    draftStep: NonNullable<LawyerVerificationDraft['step']> | null;
    verificationStatus: LawyerVerificationStatus | null;
  };
  marketplace: {
    draftStep: MarketplaceDraftView['step'] | null;
  };
  ai: BotAiRuntimeView;
}
