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
export type OnboardingStatus = 'language_selection' | 'role_selection' | 'name_required' | 'active';

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
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
  requestId: string;
}
