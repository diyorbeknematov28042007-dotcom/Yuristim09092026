import type { UserView } from '@yuristim/types';
import type { User as TelegramUser } from 'grammy/types';
import type { TelegramIdentity } from '../api/yuristim-api.client.js';

export function telegramIdentity(user: TelegramUser): TelegramIdentity {
  return {
    telegramFirstName: user.first_name || null,
    telegramUserId: user.id,
    telegramUsername: user.username ?? null,
  };
}

export function displayName(user: UserView): string {
  if (user.fullName) return user.fullName;
  if (user.telegramUsername) return `@${user.telegramUsername}`;
  return user.telegramFirstName ?? user.duid;
}

export function validFullName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 2 && normalized.length <= 160 ? normalized : null;
}
