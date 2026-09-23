import { randomUUID } from 'node:crypto';
import {
  DuplicateDuidError,
  DuplicateTelegramUserError,
  jsonObject,
  type CoreRepository,
  type LoginRequestRow,
  type SessionRow,
  type TelegramIdentityInput,
  type UserRow,
} from '@yuristim/db';
import type {
  BotOnboardingAction,
  BotUserContext,
  Language,
  OnboardingStatus,
  UserMode,
  UserRole,
  UserStatus,
  UserTagView,
  UserView,
} from '@yuristim/types';
import { AppError } from '../../lib/errors.js';
import {
  Argon2idPinHasher,
  generateOpaqueToken,
  hashOpaqueToken,
  type PinHasher,
} from './crypto.js';
import { SecureDuidGenerator, type DuidGenerator } from './duid.js';

const MAX_DUID_ATTEMPTS = 5;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MILLISECONDS = 15 * 60 * 1_000;

export interface AuthServiceOptions {
  challengeTtlSeconds: number;
  duidGenerator?: DuidGenerator;
  now?: () => Date;
  pinHasher?: PinHasher;
  sessionSecret: string;
  sessionTtlSeconds: number;
}

export interface AuthenticatedSession {
  session: SessionRow;
  user: UserRow;
}

export interface IssuedSession extends AuthenticatedSession {
  rawToken: string;
}

export class CoreAuthService {
  private readonly duidGenerator: DuidGenerator;
  private readonly now: () => Date;
  private readonly pinHasher: PinHasher;

  constructor(
    private readonly repository: CoreRepository,
    private readonly options: AuthServiceOptions,
  ) {
    this.duidGenerator = options.duidGenerator ?? new SecureDuidGenerator();
    this.now = options.now ?? (() => new Date());
    this.pinHasher = options.pinHasher ?? new Argon2idPinHasher();
  }

  async ensureTelegramUser(
    identity: TelegramIdentityInput,
  ): Promise<{ created: boolean; user: UserRow }> {
    const existing = await this.repository.findUserByTelegramId(identity.telegramUserId);
    if (existing) {
      return {
        created: false,
        user: await this.repository.updateTelegramMetadata(existing.id, identity),
      };
    }

    for (let attempt = 0; attempt < MAX_DUID_ATTEMPTS; attempt += 1) {
      try {
        const user = await this.repository.createTelegramUser(
          identity,
          this.duidGenerator.generate(),
        );
        return { created: true, user };
      } catch (error) {
        if (error instanceof DuplicateDuidError) continue;
        if (error instanceof DuplicateTelegramUserError) {
          const concurrentUser = await this.repository.findUserByTelegramId(
            identity.telegramUserId,
          );
          if (concurrentUser) {
            return {
              created: false,
              user: await this.repository.updateTelegramMetadata(concurrentUser.id, identity),
            };
          }
        }
        throw error;
      }
    }

    throw new Error('Could not allocate a unique DUID');
  }

  async startTelegramLogin(): Promise<{ challenge: string; expiresAt: string; requestId: string }> {
    const now = this.now();
    const challenge = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + this.options.challengeTtlSeconds * 1_000);
    const requestId = randomUUID();

    await this.repository.createLoginRequest({
      challengeHash: hashOpaqueToken(challenge, this.options.sessionSecret),
      expiresAt,
      id: requestId,
      now,
    });

    return { challenge, expiresAt: expiresAt.toISOString(), requestId };
  }

  async getTelegramLoginStatus(requestId: string): Promise<{ expiresAt: string; status: string }> {
    const request = await this.repository.findLoginRequestById(requestId);
    if (!request) throw new AppError(404, 'NOT_FOUND', 'Login request not found');

    if (this.isExpired(request) && request.status !== 'expired') {
      await this.repository.expireLoginRequest(request.id);
      return { expiresAt: request.expires_at, status: 'expired' };
    }
    return { expiresAt: request.expires_at, status: request.status };
  }

  async confirmTelegramLogin(
    challenge: string,
    identity: TelegramIdentityInput,
  ): Promise<{ requestId: string; status: 'confirmed' }> {
    const challengeHash = hashOpaqueToken(challenge, this.options.sessionSecret);
    const loginRequest = await this.repository.findLoginRequestByChallengeHash(challengeHash);
    if (!loginRequest) {
      throw new AppError(400, 'INVALID_LOGIN_CHALLENGE', 'Login challenge is invalid');
    }
    if (this.isExpired(loginRequest)) {
      await this.repository.expireLoginRequest(loginRequest.id);
      throw new AppError(410, 'LOGIN_CHALLENGE_EXPIRED', 'Login challenge has expired');
    }
    if (loginRequest.status === 'confirmed' && loginRequest.user_id) {
      const confirmedUser = await this.repository.findUserById(loginRequest.user_id);
      if (confirmedUser?.telegram_user_id === identity.telegramUserId) {
        return { requestId: loginRequest.id, status: 'confirmed' };
      }
    }
    if (loginRequest.status !== 'pending') {
      throw new AppError(400, 'INVALID_LOGIN_CHALLENGE', 'Login challenge is no longer usable');
    }

    const { user } = await this.ensureTelegramUser(identity);
    this.assertUserActive(user);
    const confirmed = await this.repository.confirmLoginRequest({
      challengeHash,
      id: loginRequest.id,
      now: this.now(),
      userId: user.id,
    });
    if (!confirmed) {
      throw new AppError(400, 'INVALID_LOGIN_CHALLENGE', 'Login challenge could not be confirmed');
    }
    return { requestId: confirmed.id, status: 'confirmed' };
  }

  async consumeTelegramLogin(requestId: string, challenge: string): Promise<IssuedSession> {
    const user = await this.consumeLoginRequest(requestId, challenge);
    return this.issueSession(user);
  }

  async resetPin(requestId: string, challenge: string, newPin: string): Promise<IssuedSession> {
    const confirmedUser = await this.consumeLoginRequest(requestId, challenge);
    const pinHash = await this.pinHasher.hash(newPin);
    const user = await this.repository.updateUser(confirmedUser.id, {
      pin_failed_attempts: 0,
      pin_hash: pinHash,
      pin_locked_until: null,
    });
    return this.issueSession(user);
  }

  private async consumeLoginRequest(requestId: string, challenge: string): Promise<UserRow> {
    const challengeHash = hashOpaqueToken(challenge, this.options.sessionSecret);
    const request = await this.repository.findLoginRequestById(requestId);
    if (!request || request.challenge_hash !== challengeHash) {
      throw new AppError(400, 'INVALID_LOGIN_CHALLENGE', 'Login challenge is invalid');
    }
    if (this.isExpired(request)) {
      await this.repository.expireLoginRequest(request.id);
      throw new AppError(410, 'LOGIN_CHALLENGE_EXPIRED', 'Login challenge has expired');
    }

    const consumed = await this.repository.consumeLoginRequest({
      challengeHash,
      id: requestId,
      now: this.now(),
    });
    if (!consumed?.user_id) {
      throw new AppError(400, 'INVALID_LOGIN_CHALLENGE', 'Login challenge is not confirmed');
    }
    const user = await this.requireUser(consumed.user_id);
    this.assertUserActive(user);
    return user;
  }

  async verifyPin(duid: string, pin: string): Promise<IssuedSession> {
    const user = await this.repository.findUserByDuid(duid);
    if (!user) throw new AppError(401, 'INVALID_PIN', 'DUID or PIN is invalid');
    this.assertUserActive(user);

    const now = this.now();
    if (user.pin_locked_until && new Date(user.pin_locked_until).getTime() > now.getTime()) {
      throw new AppError(429, 'PIN_TEMPORARILY_LOCKED', 'PIN verification is temporarily locked');
    }

    const valid = user.pin_hash ? await this.pinHasher.verify(user.pin_hash, pin) : false;
    if (!valid) {
      const failedAttempts = Math.min(user.pin_failed_attempts + 1, MAX_PIN_ATTEMPTS);
      const lockedUntil =
        failedAttempts >= MAX_PIN_ATTEMPTS
          ? new Date(now.getTime() + PIN_LOCK_MILLISECONDS).toISOString()
          : null;
      await this.repository.updateUser(user.id, {
        pin_failed_attempts: failedAttempts,
        pin_locked_until: lockedUntil,
      });
      if (lockedUntil) {
        throw new AppError(429, 'PIN_TEMPORARILY_LOCKED', 'PIN verification is temporarily locked');
      }
      throw new AppError(401, 'INVALID_PIN', 'DUID or PIN is invalid');
    }

    const updated = await this.repository.updateUser(user.id, {
      pin_failed_attempts: 0,
      pin_locked_until: null,
    });
    return this.issueSession(updated);
  }

  async authenticate(rawToken: string): Promise<AuthenticatedSession> {
    const tokenHash = hashOpaqueToken(rawToken, this.options.sessionSecret);
    const session = await this.repository.findSessionByTokenHash(tokenHash);
    const now = this.now();
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= now.getTime()) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required');
    }
    const user = await this.requireUser(session.user_id);
    this.assertUserActive(user);
    await this.repository.touchSession(session.id, now);
    return { session, user };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repository.revokeSession(sessionId, this.now());
  }

  async updateProfile(userId: string, fullName: string | null): Promise<UserRow> {
    return this.repository.updateUser(userId, { full_name: fullName });
  }

  async updateLanguage(userId: string, language: Language): Promise<UserRow> {
    const user = await this.requireUser(userId);
    const onboardingStatus =
      user.onboarding_status === 'language_selection' ? 'role_selection' : user.onboarding_status;
    return this.repository.updateUser(userId, {
      language,
      onboarding_status: onboardingStatus,
    });
  }

  async acceptTerms(userId: string, version: string): Promise<UserRow> {
    const user = await this.requireUser(userId);
    return this.repository.updateUser(userId, {
      onboarding_status: this.completedStatus(user),
      terms_accepted_at: this.now().toISOString(),
      terms_version: version,
    });
  }

  async selectRole(userId: string, role: UserRole): Promise<UserRow> {
    const user = await this.requireUser(userId);
    if (role === 'lawyer' && !user.full_name) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Full name is required for lawyer onboarding');
    }
    return this.repository.updateUser(userId, {
      active_mode: 'user',
      onboarding_role: role,
      onboarding_status: user.terms_accepted_at ? 'completed' : 'terms_acceptance',
    });
  }

  async getTelegramUserContext(telegramUserId: number): Promise<BotUserContext> {
    const user = await this.repository.findUserByTelegramId(telegramUserId);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    this.assertUserActive(user);
    return { hasPin: user.pin_hash !== null, user: this.toUserView(user) };
  }

  async updateTelegramOnboarding(
    telegramUserId: number,
    action: BotOnboardingAction,
  ): Promise<BotUserContext> {
    const user = await this.repository.findUserByTelegramId(telegramUserId);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    this.assertUserActive(user);

    let updated: UserRow;
    switch (action.action) {
      case 'set_language':
        updated = await this.repository.updateUser(user.id, {
          language: action.language,
          onboarding_status:
            user.onboarding_status === 'completed'
              ? 'completed'
              : user.onboarding_role === null
                ? 'role_selection'
                : this.nextOnboardingStatus(user),
        });
        break;
      case 'set_role': {
        const nextUser = { ...user, onboarding_role: action.role };
        updated = await this.repository.updateUser(user.id, {
          active_mode: 'user',
          onboarding_role: action.role,
          onboarding_status: this.nextOnboardingStatus(nextUser),
        });
        break;
      }
      case 'set_full_name': {
        if (user.onboarding_role !== 'lawyer') {
          throw new AppError(400, 'VALIDATION_ERROR', 'Full name is not required for this role');
        }
        const fullName = action.fullName.trim();
        updated = await this.repository.updateUser(user.id, {
          full_name: fullName,
          onboarding_status: user.terms_accepted_at ? 'completed' : 'terms_acceptance',
        });
        break;
      }
      case 'accept_terms':
        if (
          user.language === null ||
          user.onboarding_role === null ||
          (user.onboarding_role === 'lawyer' && user.full_name === null)
        ) {
          throw new AppError(409, 'VALIDATION_ERROR', 'Onboarding profile is incomplete');
        }
        if (user.onboarding_status === 'completed' && user.terms_accepted_at !== null) {
          return { hasPin: user.pin_hash !== null, user: this.toUserView(user) };
        }
        updated = await this.repository.updateUser(user.id, {
          onboarding_status: 'completed',
          terms_accepted_at: this.now().toISOString(),
          terms_version: action.termsVersion,
        });
        break;
      case 'reset':
        updated = await this.repository.updateUser(user.id, {
          active_mode: 'user',
          full_name: null,
          language: null,
          onboarding_role: null,
          onboarding_status: 'language_selection',
          terms_accepted_at: null,
          terms_version: null,
        });
        break;
    }

    return { hasPin: updated.pin_hash !== null, user: this.toUserView(updated) };
  }

  async switchMode(userId: string, mode: UserMode): Promise<UserRow> {
    if (mode === 'lawyer') {
      throw new AppError(409, 'LAWYER_NOT_VERIFIED', 'Lawyer verification is required');
    }
    return this.repository.updateUser(userId, { active_mode: 'user' });
  }

  async getTags(userId: string): Promise<UserTagView[]> {
    const tags = await this.repository.listUserTags(userId, this.now());
    return tags.map((tag) => ({
      createdAt: tag.created_at,
      expiresAt: tag.expires_at,
      id: tag.id,
      metadata: jsonObject(tag.metadata),
      tag: tag.tag,
    }));
  }

  toUserView(user: UserRow): UserView {
    return {
      activeMode: user.active_mode as UserMode,
      createdAt: user.created_at,
      duid: user.duid,
      fullName: user.full_name,
      id: user.id,
      language: user.language as Language | null,
      onboardingRole: user.onboarding_role as UserRole | null,
      onboardingStatus: user.onboarding_status as OnboardingStatus,
      status: user.status as UserStatus,
      telegramFirstName: user.telegram_first_name,
      telegramUserId: String(user.telegram_user_id),
      telegramUsername: user.telegram_username,
      termsAcceptedAt: user.terms_accepted_at,
      termsVersion: user.terms_version,
      updatedAt: user.updated_at,
    };
  }

  private async issueSession(user: UserRow): Promise<IssuedSession> {
    const now = this.now();
    const rawToken = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlSeconds * 1_000);
    const session = await this.repository.createSession({
      expiresAt,
      now,
      tokenHash: hashOpaqueToken(rawToken, this.options.sessionSecret),
      userId: user.id,
    });
    return { rawToken, session, user };
  }

  private async requireUser(id: string): Promise<UserRow> {
    const user = await this.repository.findUserById(id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    return user;
  }

  private completedStatus(user: UserRow): OnboardingStatus {
    return user.language &&
      user.onboarding_role &&
      (user.onboarding_role !== 'lawyer' || user.full_name)
      ? 'completed'
      : user.onboarding_status === 'name_required'
        ? 'name_required'
        : 'terms_acceptance';
  }

  private nextOnboardingStatus(user: UserRow): OnboardingStatus {
    if (user.language === null) return 'language_selection';
    if (user.onboarding_role === null) return 'role_selection';
    if (user.onboarding_role === 'lawyer' && user.full_name === null) return 'name_required';
    if (user.terms_accepted_at === null) return 'terms_acceptance';
    return 'completed';
  }

  private assertUserActive(user: UserRow): void {
    if (user.status === 'blocked') {
      throw new AppError(403, 'USER_BLOCKED', 'User is blocked');
    }
  }

  private isExpired(request: LoginRequestRow): boolean {
    return new Date(request.expires_at).getTime() <= this.now().getTime();
  }
}
