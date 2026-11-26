import { describe, expect, it, vi } from 'vitest';
import { handleTelegramWebhook } from './webhook.js';

const secret = 'test_webhook_secret';
function request(updateId: number, key = secret) {
  return new Request('https://example.test/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': key },
    body: JSON.stringify({
      update_id: updateId,
      message: { chat: { id: 42 }, text: 'Private legal matter' },
    }),
  });
}
describe('Telegram webhook ingress', () => {
  it('rejects forged and malformed requests without touching storage or handlers', async () => {
    const claim = vi.fn();
    const process = vi.fn();
    const store = { claim, finish: vi.fn() };
    expect(
      (await handleTelegramWebhook(request(1, 'wrong'), { secret, store, process })).status,
    ).toBe(403);
    expect(
      (
        await handleTelegramWebhook(new Request('https://example.test', { method: 'GET' }), {
          secret,
          store,
          process,
        })
      ).status,
    ).toBe(405);
    expect(
      (
        await handleTelegramWebhook(
          new Request('https://example.test', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-telegram-bot-api-secret-token': secret,
            },
            body: JSON.stringify({ message: { text: 'missing id' } }),
          }),
          { secret, store, process },
        )
      ).status,
    ).toBe(400);
    expect(claim).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });

  it('acknowledges completed updates and returns retryable failures for busy or failed handlers', async () => {
    const claim = vi
      .fn()
      .mockResolvedValueOnce({ status: 'acquired', leaseId: 'lease' })
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ status: 'busy' })
      .mockResolvedValueOnce({ status: 'acquired', leaseId: 'retry' });
    const finish = vi.fn().mockResolvedValue(true);
    const process = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Private error'));
    const store = { claim, finish };
    const options = { secret, store, process, now: () => new Date('2026-11-26T12:00:00Z') };
    expect((await handleTelegramWebhook(request(1), options)).status).toBe(200);
    expect(claim).toHaveBeenCalledWith(1, 42, new Date('2026-11-26T12:00:00Z'));
    expect((await handleTelegramWebhook(request(1), options)).status).toBe(200);
    expect((await handleTelegramWebhook(request(2), options)).status).toBe(503);
    expect((await handleTelegramWebhook(request(3), options)).status).toBe(503);
    expect(process).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenLastCalledWith(3, 'retry', false, expect.any(Date));
  });
});
