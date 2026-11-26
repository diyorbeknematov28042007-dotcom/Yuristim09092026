/** A fetch-based ingress for the existing grammY bot; call bot.handleUpdate in process. */
interface TelegramUpdate {
  update_id: number;
  [key: string]: unknown;
}
interface ClaimStore {
  claim(
    updateId: number,
    chatId: number | null,
    now: Date,
  ): Promise<{ status: 'acquired'; leaseId: string } | { status: 'completed' | 'busy' }>;
  finish(updateId: number, leaseId: string, success: boolean, now: Date): Promise<boolean>;
}
interface WebhookOptions {
  secret: string;
  store: ClaimStore;
  process: (update: TelegramUpdate) => Promise<void>;
  now?: () => Date;
}

async function equalSecret(left: string, right: string): Promise<boolean> {
  if (!right || right.length > 256 || !/^[A-Za-z0-9_-]+$/.test(right)) return false;
  const [a, b] = await Promise.all(
    [left, right].map((value) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  );
  const first = new Uint8Array(a!);
  const second = new Uint8Array(b!);
  let difference = 0;
  for (let i = 0; i < first.length; i++) difference |= first[i]! ^ second[i]!;
  return difference === 0;
}
function chatId(update: TelegramUpdate): number | null {
  for (const key of [
    'message',
    'edited_message',
    'channel_post',
    'edited_channel_post',
    'my_chat_member',
    'chat_member',
    'chat_join_request',
  ]) {
    const value = update[key] as { chat?: { id?: unknown } } | undefined;
    if (Number.isSafeInteger(value?.chat?.id)) return value!.chat!.id as number;
  }
  const callback = update.callback_query as { message?: { chat?: { id?: unknown } } } | undefined;
  const value = callback?.message?.chat?.id;
  if (Number.isSafeInteger(value)) return value as number;
  for (const key of ['callback_query', 'inline_query', 'chosen_inline_result']) {
    const origin = update[key] as { from?: { id?: unknown } } | undefined;
    if (Number.isSafeInteger(origin?.from?.id)) return origin!.from!.id as number;
  }
  return null;
}

export async function handleTelegramWebhook(
  request: Request,
  options: WebhookOptions,
): Promise<Response> {
  const now = options.now ?? (() => new Date());
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (
    !(await equalSecret(
      request.headers.get('x-telegram-bot-api-secret-token') ?? '',
      options.secret,
    ))
  )
    return new Response(null, { status: 403 });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return new Response(null, { status: 415 });
  const length = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > 1_048_576) return new Response(null, { status: 413 });
  let update: TelegramUpdate;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1_048_576)
      return new Response(null, { status: 413 });
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !Number.isSafeInteger((parsed as TelegramUpdate).update_id) ||
      (parsed as TelegramUpdate).update_id < 0
    )
      return new Response(null, { status: 400 });
    update = parsed as TelegramUpdate;
  } catch {
    return new Response(null, { status: 400 });
  }
  let lease: Awaited<ReturnType<ClaimStore['claim']>>;
  try {
    lease = await options.store.claim(update.update_id, chatId(update), now());
  } catch {
    return new Response(null, { status: 503 });
  }
  if (lease.status === 'completed') return new Response(null, { status: 200 });
  if (!('leaseId' in lease))
    return new Response(null, { status: 503, headers: { 'Retry-After': '1' } });
  try {
    await options.process(update);
    const finished = await options.store.finish(update.update_id, lease.leaseId, true, now());
    return new Response(null, { status: finished ? 200 : 503 });
  } catch {
    try {
      await options.store.finish(update.update_id, lease.leaseId, false, now());
    } catch {
      // Telegram retries after 503; the lease will expire if the database is down.
    }
    return new Response(null, { status: 503 });
  }
}
