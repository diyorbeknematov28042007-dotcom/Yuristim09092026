import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TelegramIdentityInput } from '@yuristim/db';
import { AppError } from '../../lib/errors.js';

export function verifyTelegramInitData(
  initData: string,
  token: string,
  now = Date.now(),
): TelegramIdentityInput {
  const invalid = () => new AppError(401, 'UNAUTHORIZED', 'Invalid Telegram authentication');
  const params = new URLSearchParams(initData);
  const entries = [...params.entries()];
  if (entries.length < 3 || new Set(entries.map(([key]) => key)).size !== entries.length)
    throw invalid();
  const hash = params.get('hash');
  const authDate = params.get('auth_date');
  const userJson = params.get('user');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !authDate || !/^\d+$/.test(authDate) || !userJson)
    throw invalid();
  const age = now - Number(authDate) * 1000;
  if (age < -60_000 || age > 86_400_000) throw invalid();
  const checkString = entries
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw invalid();
  let user: unknown;
  try {
    user = JSON.parse(userJson);
  } catch {
    throw invalid();
  }
  if (!user || typeof user !== 'object') throw invalid();
  const identity = user as Record<string, unknown>;
  if (typeof identity.id !== 'number' || !Number.isSafeInteger(identity.id) || identity.id <= 0)
    throw invalid();
  return {
    telegramUserId: identity.id,
    telegramFirstName:
      typeof identity.first_name === 'string' ? identity.first_name.slice(0, 128) : null,
    telegramUsername: typeof identity.username === 'string' ? identity.username.slice(0, 64) : null,
  };
}
