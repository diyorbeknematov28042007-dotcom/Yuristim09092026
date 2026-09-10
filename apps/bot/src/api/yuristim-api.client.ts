import { createHmac, randomUUID } from 'node:crypto';
import {
  LANGUAGES,
  USER_MODES,
  USER_ROLES,
  type ApiErrorCode,
  type BotLawyerContext,
  type BotOnboardingAction,
  type BotUserContext,
  type BotVerificationAction,
  type CreditBalanceView,
  type CreditProductView,
  type CreditTransactionPage,
  type MarketplaceAcceptBalanceView,
  type MarketplaceAcceptProductView,
  type UserView,
} from '@yuristim/types';
import { z } from 'zod';

export interface TelegramIdentity {
  telegramFirstName: string | null;
  telegramUserId: number;
  telegramUsername: string | null;
}

export interface EnsureUserResult {
  created: boolean;
  user: UserView;
}

export interface YuristimApi {
  ensureTelegramUser(identity: TelegramIdentity): Promise<EnsureUserResult>;
  getTelegramUserContext(telegramUserId: number): Promise<BotUserContext>;
  updateOnboarding(telegramUserId: number, action: BotOnboardingAction): Promise<BotUserContext>;
  getLawyerContext(telegramUserId: number): Promise<BotLawyerContext>;
  updateVerification(
    telegramUserId: number,
    action: BotVerificationAction,
  ): Promise<BotLawyerContext['verification']>;
  uploadVerificationFile(
    telegramUserId: number,
    input: {
      base64: string;
      contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
      kind: 'profile_image' | 'verification_document';
      originalFilename: string;
    },
  ): Promise<{ path: string }>;
  switchMode(telegramUserId: number, mode: 'user' | 'lawyer'): Promise<UserView>;
  getCreditBalance(telegramUserId: number): Promise<CreditBalanceView>;
  getCreditHistory(telegramUserId: number): Promise<CreditTransactionPage>;
  getCreditProducts(telegramUserId: number): Promise<CreditProductView[]>;
  getAcceptBalance(telegramUserId: number): Promise<MarketplaceAcceptBalanceView>;
  getAcceptProducts(telegramUserId: number): Promise<MarketplaceAcceptProductView[]>;
}

export class YuristimApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | 'API_UNAVAILABLE' | 'MALFORMED_RESPONSE',
    readonly statusCode: number,
  ) {
    super('Yuristim API request failed');
    this.name = 'YuristimApiError';
  }
}

const onboardingStatuses = [
  'language_selection',
  'role_selection',
  'name_required',
  'terms_acceptance',
  'completed',
] as const;
const userSchema = z.object({
  activeMode: z.enum(USER_MODES),
  createdAt: z.string(),
  duid: z.string(),
  fullName: z.string().nullable(),
  id: z.string(),
  language: z.enum(LANGUAGES).nullable(),
  onboardingRole: z.enum(USER_ROLES).nullable(),
  onboardingStatus: z.enum(onboardingStatuses),
  status: z.enum(['active', 'blocked']),
  telegramFirstName: z.string().nullable(),
  telegramUserId: z.string(),
  telegramUsername: z.string().nullable(),
  termsAcceptedAt: z.string().nullable(),
  termsVersion: z.string().nullable(),
  updatedAt: z.string(),
});
const ensureSchema = z.object({ created: z.boolean(), user: userSchema });
const contextSchema = z.object({ hasPin: z.boolean(), user: userSchema });
const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const specializationSchema = z.object({ code: z.string(), id: z.string(), name: z.string() });
const verificationSchema = z.object({
  draft: z.object({
    bio: z.string().optional(),
    consultationPrice: z.number().nullable().optional(),
    experienceYears: z.number().optional(),
    fullName: z.string().optional(),
    profileImagePath: z.string().optional(),
    region: z.string().optional(),
    specializationCodes: z.array(z.string()).optional(),
    step: z
      .enum([
        'full_name',
        'region',
        'specializations',
        'experience',
        'bio',
        'price',
        'profile_image',
        'verification_document',
        'summary',
      ])
      .optional(),
    verificationDocumentPaths: z.array(z.string()).optional(),
  }),
  id: z.string(),
  rejectReason: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  status: z.enum(['draft', 'submitted', 'pending_review', 'approved', 'rejected']),
  submittedAt: z.string().nullable(),
  type: z.enum(['initial', 'profile_update']),
});
const profileSchema = z.object({
  bio: z.string().nullable(),
  consultationPrice: z.number().nullable(),
  createdAt: z.string(),
  currency: z.literal('UZS'),
  duid: z.string(),
  experienceYears: z.number().nullable(),
  fullName: z.string().nullable(),
  id: z.string(),
  jobsCount: z.number(),
  profileImageUrl: z.string().nullable(),
  publicSlug: z.string(),
  ratingAverage: z.number(),
  ratingCount: z.number(),
  region: z.string().nullable(),
  specializations: z.array(specializationSchema),
  telegramUsername: z.string().nullable(),
  verificationStatus: z.enum([
    'unverified',
    'draft',
    'submitted',
    'pending_review',
    'approved',
    'rejected',
    'resubmitted',
  ]),
  verifiedAt: z.string().nullable(),
});
const lawyerContextSchema = z.object({
  profile: profileSchema.nullable(),
  specializations: z.array(specializationSchema),
  verification: verificationSchema.nullable(),
});
const verificationResponseSchema = z.object({ verification: verificationSchema.nullable() });
const pathSchema = z.object({ path: z.string() });
const creditBalanceSchema = z.object({
  bonus: z.number(),
  lowBalance: z.boolean(),
  nextExpiry: z.string().nullable(),
  paid: z.number(),
  total: z.number(),
  weekly: z.number(),
  zeroBalance: z.boolean(),
});
const creditTransactionSchema = z.object({
  amount: z.number(),
  balanceAfter: z.number(),
  bucketType: z.enum(['paid', 'weekly', 'bonus']),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  id: z.string(),
  reason: z.string().nullable(),
  type: z.enum([
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
  ]),
});
const creditHistorySchema = z.object({
  items: z.array(creditTransactionSchema),
  limit: z.number(),
  page: z.number(),
  total: z.number(),
});
const creditProductSchema = z.object({
  code: z.string(),
  creditAmount: z.number(),
  currency: z.literal('UZS'),
  id: z.string(),
  name: z.string(),
  price: z.number(),
});
const acceptBalanceSchema = z.object({
  balance: z.number(),
  nextExpiry: z.string().nullable(),
});
const acceptProductSchema = z.object({
  acceptCount: z.number(),
  code: z.string(),
  currency: z.literal('UZS'),
  expiresInDays: z.number().nullable(),
  id: z.string(),
  name: z.string(),
  price: z.number(),
});

interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  internalApiSecret: string;
  now?: () => number;
  requestId?: () => string;
  timeoutMilliseconds?: number;
}

export function createInternalSignature(
  method: string,
  path: string,
  body: unknown,
  timestamp: string,
  secret: string,
): string {
  return `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${method.toUpperCase()}.${path}.${JSON.stringify(body)}`)
    .digest('hex')}`;
}

export class YuristimApiClient implements YuristimApi {
  private readonly baseUrl: URL;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly requestId: () => string;
  private readonly timeoutMilliseconds: number;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.requestId = options.requestId ?? randomUUID;
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 5_000;
  }

  async ensureTelegramUser(identity: TelegramIdentity): Promise<EnsureUserResult> {
    const payload = await this.request('POST', '/internal/telegram/users/ensure', identity);
    return this.parse(ensureSchema, payload);
  }

  async getTelegramUserContext(telegramUserId: number): Promise<BotUserContext> {
    const payload = await this.request('GET', `/internal/telegram/users/${telegramUserId}/context`);
    return this.parse(contextSchema, payload);
  }

  async updateOnboarding(
    telegramUserId: number,
    action: BotOnboardingAction,
  ): Promise<BotUserContext> {
    const payload = await this.request(
      'PATCH',
      `/internal/telegram/users/${telegramUserId}/onboarding`,
      action,
    );
    return this.parse(contextSchema, payload);
  }

  async getLawyerContext(telegramUserId: number): Promise<BotLawyerContext> {
    return this.parse(
      lawyerContextSchema,
      await this.request('GET', `/internal/telegram/users/${telegramUserId}/lawyer`),
    );
  }

  async updateVerification(
    telegramUserId: number,
    action: BotVerificationAction,
  ): Promise<BotLawyerContext['verification']> {
    const payload = await this.request(
      'PATCH',
      `/internal/telegram/users/${telegramUserId}/lawyer/verification`,
      action,
    );
    return this.parse(verificationResponseSchema, payload).verification;
  }

  async uploadVerificationFile(
    telegramUserId: number,
    input: {
      base64: string;
      contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
      kind: 'profile_image' | 'verification_document';
      originalFilename: string;
    },
  ): Promise<{ path: string }> {
    return this.parse(
      pathSchema,
      await this.request('POST', `/internal/telegram/users/${telegramUserId}/lawyer/files`, input),
    );
  }

  async switchMode(telegramUserId: number, mode: 'user' | 'lawyer'): Promise<UserView> {
    const payload = await this.request('POST', `/internal/telegram/users/${telegramUserId}/mode`, {
      mode,
    });
    return this.parse(z.object({ user: userSchema }), payload).user;
  }

  async getCreditBalance(telegramUserId: number): Promise<CreditBalanceView> {
    return this.parse(
      creditBalanceSchema,
      await this.request('GET', `/internal/telegram/users/${telegramUserId}/credits/balance`),
    );
  }

  async getCreditHistory(telegramUserId: number): Promise<CreditTransactionPage> {
    return this.parse(
      creditHistorySchema,
      await this.request('GET', `/internal/telegram/users/${telegramUserId}/credits/transactions`),
    );
  }

  async getCreditProducts(telegramUserId: number): Promise<CreditProductView[]> {
    const payload = await this.request(
      'GET',
      `/internal/telegram/users/${telegramUserId}/credits/products`,
    );
    return this.parse(z.object({ items: z.array(creditProductSchema) }), payload).items;
  }

  async getAcceptBalance(telegramUserId: number): Promise<MarketplaceAcceptBalanceView> {
    return this.parse(
      acceptBalanceSchema,
      await this.request(
        'GET',
        `/internal/telegram/users/${telegramUserId}/marketplace/accept-balance`,
      ),
    );
  }

  async getAcceptProducts(telegramUserId: number): Promise<MarketplaceAcceptProductView[]> {
    const payload = await this.request(
      'GET',
      `/internal/telegram/users/${telegramUserId}/marketplace/accept-products`,
    );
    return this.parse(z.object({ items: z.array(acceptProductSchema) }), payload).items;
  }

  private parse<T>(schema: z.ZodType<T>, payload: unknown): T {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new YuristimApiError('MALFORMED_RESPONSE', 502);
    return parsed.data;
  }

  private async request(method: 'GET' | 'PATCH' | 'POST', path: string, body?: unknown) {
    const timestamp = String(Math.floor(this.now() / 1_000));
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMilliseconds);

    try {
      const response = await this.fetchImplementation(new URL(path, this.baseUrl), {
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
        headers: {
          ...(serializedBody ? { 'content-type': 'application/json' } : {}),
          'x-request-id': this.requestId(),
          'x-yuristim-signature': createInternalSignature(
            method,
            path,
            body,
            timestamp,
            this.options.internalApiSecret,
          ),
          'x-yuristim-timestamp': timestamp,
        },
        method,
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedError = errorSchema.safeParse(payload);
        const code = parsedError.success
          ? (parsedError.data.error.code as ApiErrorCode)
          : 'API_UNAVAILABLE';
        throw new YuristimApiError(code, response.status);
      }
      return payload;
    } catch (error) {
      if (error instanceof YuristimApiError) throw error;
      throw new YuristimApiError('API_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer);
    }
  }
}
