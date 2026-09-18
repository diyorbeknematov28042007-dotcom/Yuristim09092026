import { describe, expect, it } from 'vitest';
import { loadBotEnv } from './env.js';

const required = {
  ADMIN_TELEGRAM_ID: '123456789',
  INTERNAL_BOT_API_SECRET: 'test-internal-api-secret-32-characters',
  MARKETPLACE_CHANNEL_ID: '-1003512004134',
  MARKETPLACE_CHANNEL_URL: 'https://t.me/yuristim_marketplace',
  NODE_ENV: 'test',
  TELEGRAM_BOT_TOKEN: 'test-token',
};

describe('Telegram AI sticker environment', () => {
  it('accepts non-secret sticker file IDs and treats empty values as unconfigured', () => {
    const configured = loadBotEnv({
      ...required,
      TELEGRAM_AI_DOCUMENT_STICKER_FILE_ID: 'document-file-id',
      TELEGRAM_AI_EXPERT_STICKER_FILE_ID: 'expert-file-id',
      TELEGRAM_AI_FAST_STICKER_FILE_ID: 'fast-file-id',
    });
    expect(configured).toMatchObject({
      TELEGRAM_AI_DOCUMENT_STICKER_FILE_ID: 'document-file-id',
      TELEGRAM_AI_EXPERT_STICKER_FILE_ID: 'expert-file-id',
      TELEGRAM_AI_FAST_STICKER_FILE_ID: 'fast-file-id',
    });

    const empty = loadBotEnv({
      ...required,
      TELEGRAM_AI_DOCUMENT_STICKER_FILE_ID: '',
      TELEGRAM_AI_EXPERT_STICKER_FILE_ID: '',
      TELEGRAM_AI_FAST_STICKER_FILE_ID: '',
    });
    expect(empty.TELEGRAM_AI_FAST_STICKER_FILE_ID).toBeUndefined();
    expect(empty.TELEGRAM_AI_EXPERT_STICKER_FILE_ID).toBeUndefined();
    expect(empty.TELEGRAM_AI_DOCUMENT_STICKER_FILE_ID).toBeUndefined();
  });
});
