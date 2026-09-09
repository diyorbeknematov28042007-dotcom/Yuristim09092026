import { createHmac } from 'node:crypto';

export interface TelegramIdentity {
  telegramFirstName: string | null;
  telegramUserId: number;
  telegramUsername: string | null;
}

export class YuristimApiClient {
  readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly internalApiSecret: string,
  ) {
    this.baseUrl = new URL(baseUrl);
  }

  ensureTelegramUser(identity: TelegramIdentity): Promise<unknown> {
    return this.postInternal('/internal/telegram/users/ensure', identity);
  }

  confirmTelegramLogin(challenge: string, identity: TelegramIdentity): Promise<unknown> {
    return this.postInternal('/internal/telegram/auth/confirm', { challenge, identity });
  }

  private async postInternal(path: string, body: unknown): Promise<unknown> {
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const serializedBody = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', this.internalApiSecret)
      .update(`${timestamp}.${serializedBody}`)
      .digest('hex')}`;
    const response = await fetch(new URL(path, this.baseUrl), {
      body: serializedBody,
      headers: {
        'content-type': 'application/json',
        'x-yuristim-signature': signature,
        'x-yuristim-timestamp': timestamp,
      },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Yuristim API request failed (${response.status})`);
    }
    return response.json();
  }
}
