import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import {
  DuplicateDuidError,
  DuplicateTelegramUserError,
  type CoreRepository,
  type LoginRequestRow,
  type SessionRow,
  type TelegramIdentityInput,
  type UserRow,
  type UserTagRow,
  type UserUpdate,
} from './repository.js';

function throwDatabaseError(error: PostgrestError): never {
  if (error.code === '23505' && error.message.includes('users_duid_key')) {
    throw new DuplicateDuidError();
  }
  if (error.code === '23505' && error.message.includes('users_telegram_user_id_key')) {
    throw new DuplicateTelegramUserError();
  }
  throw new Error(`Database operation failed (${error.code})`);
}

function requireData<T>(data: T | null, error: PostgrestError | null): T {
  if (error) throwDatabaseError(error);
  if (data === null) throw new Error('Database operation returned no data');
  return data;
}

export class SupabaseCoreRepository implements CoreRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async findUserById(id: string): Promise<UserRow | null> {
    const { data, error } = await this.client.from('users').select('*').eq('id', id).maybeSingle();
    if (error) throwDatabaseError(error);
    return data;
  }

  async findUserByDuid(duid: string): Promise<UserRow | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('duid', duid)
      .maybeSingle();
    if (error) throwDatabaseError(error);
    return data;
  }

  async findUserByTelegramId(telegramUserId: number): Promise<UserRow | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle();
    if (error) throwDatabaseError(error);
    return data;
  }

  async createTelegramUser(identity: TelegramIdentityInput, duid: string): Promise<UserRow> {
    const { data, error } = await this.client
      .from('users')
      .insert({
        duid,
        telegram_first_name: identity.telegramFirstName,
        telegram_user_id: identity.telegramUserId,
        telegram_username: identity.telegramUsername,
      })
      .select('*')
      .single();
    return requireData(data, error);
  }

  async updateTelegramMetadata(id: string, identity: TelegramIdentityInput): Promise<UserRow> {
    const { data, error } = await this.client
      .from('users')
      .update({
        telegram_first_name: identity.telegramFirstName,
        telegram_username: identity.telegramUsername,
      })
      .eq('id', id)
      .select('*')
      .single();
    return requireData(data, error);
  }

  async updateUser(id: string, update: UserUpdate): Promise<UserRow> {
    const { data, error } = await this.client
      .from('users')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    return requireData(data, error);
  }

  async listUserTags(userId: string, now: Date): Promise<UserTagRow[]> {
    const { data, error } = await this.client
      .from('user_tags')
      .select('*')
      .eq('user_id', userId)
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
      .order('created_at');
    if (error) throwDatabaseError(error);
    return data;
  }

  async isLawyerApproved(userId: string): Promise<boolean> {
    const { count, error } = await this.client
      .from('lawyer_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('verification_status', 'approved');
    if (error) throwDatabaseError(error);
    return count === 1;
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<SessionRow> {
    const { data, error } = await this.client
      .from('auth_sessions')
      .insert({
        created_at: input.now.toISOString(),
        expires_at: input.expiresAt.toISOString(),
        last_seen_at: input.now.toISOString(),
        token_hash: input.tokenHash,
        user_id: input.userId,
      })
      .select('*')
      .single();
    return requireData(data, error);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const { data, error } = await this.client
      .from('auth_sessions')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (error) throwDatabaseError(error);
    return data;
  }

  async touchSession(id: string, now: Date): Promise<void> {
    const { error } = await this.client
      .from('auth_sessions')
      .update({ last_seen_at: now.toISOString() })
      .eq('id', id);
    if (error) throwDatabaseError(error);
  }

  async revokeSession(id: string, now: Date): Promise<void> {
    const { error } = await this.client
      .from('auth_sessions')
      .update({ revoked_at: now.toISOString() })
      .eq('id', id)
      .is('revoked_at', null);
    if (error) throwDatabaseError(error);
  }

  async createLoginRequest(input: {
    id: string;
    challengeHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<LoginRequestRow> {
    const { data, error } = await this.client
      .from('auth_login_requests')
      .insert({
        challenge_hash: input.challengeHash,
        created_at: input.now.toISOString(),
        expires_at: input.expiresAt.toISOString(),
        id: input.id,
      })
      .select('*')
      .single();
    return requireData(data, error);
  }

  async findLoginRequestById(id: string): Promise<LoginRequestRow | null> {
    const { data, error } = await this.client
      .from('auth_login_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throwDatabaseError(error);
    return data;
  }

  async findLoginRequestByChallengeHash(challengeHash: string): Promise<LoginRequestRow | null> {
    const { data, error } = await this.client
      .from('auth_login_requests')
      .select('*')
      .eq('challenge_hash', challengeHash)
      .maybeSingle();
    if (error) throwDatabaseError(error);
    return data;
  }

  async confirmLoginRequest(input: {
    id: string;
    challengeHash: string;
    userId: string;
    now: Date;
  }): Promise<LoginRequestRow | null> {
    const { data, error } = await this.client
      .from('auth_login_requests')
      .update({
        confirmed_at: input.now.toISOString(),
        status: 'confirmed',
        user_id: input.userId,
      })
      .eq('id', input.id)
      .eq('challenge_hash', input.challengeHash)
      .eq('status', 'pending')
      .gt('expires_at', input.now.toISOString())
      .select('*')
      .maybeSingle();
    if (error) throwDatabaseError(error);
    return data;
  }

  async consumeLoginRequest(input: {
    id: string;
    challengeHash: string;
    now: Date;
  }): Promise<LoginRequestRow | null> {
    const { data, error } = await this.client
      .from('auth_login_requests')
      .update({ consumed_at: input.now.toISOString(), status: 'consumed' })
      .eq('id', input.id)
      .eq('challenge_hash', input.challengeHash)
      .eq('status', 'confirmed')
      .gt('expires_at', input.now.toISOString())
      .select('*')
      .maybeSingle();
    if (error) throwDatabaseError(error);
    return data;
  }

  async expireLoginRequest(id: string): Promise<void> {
    const { error } = await this.client
      .from('auth_login_requests')
      .update({ status: 'expired' })
      .eq('id', id)
      .in('status', ['pending', 'confirmed']);
    if (error) throwDatabaseError(error);
  }
}
