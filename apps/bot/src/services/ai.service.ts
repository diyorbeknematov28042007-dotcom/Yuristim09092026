import type { AiConversationView, Language } from '@yuristim/types';
import type { YuristimBotContext } from '../bot.js';
import { YuristimApiError } from '../api/yuristim-api.client.js';
import { t } from '../i18n/index.js';
import {
  aiFileRedirectKeyboard,
  aiHistoryKeyboard,
  aiHomeKeyboard,
} from '../keyboards/ai.keyboard.js';
import { editOrReply } from './navigation.service.js';

function credits(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function homeText(language: Language, conversation: AiConversationView, balance: number): string {
  const mode =
    conversation.mode === 'fast' ? t(language, 'aiModeFast') : t(language, 'aiModeExpert');
  return [
    t(language, 'aiTitle'),
    '',
    `${t(language, 'aiCurrentMode')}: ${mode}`,
    `${t(language, 'totalBalance')}: ${credits(balance)}`,
    '',
    t(language, 'aiPrompt'),
    t(language, 'aiSourcesUnavailable'),
  ].join('\n');
}

export async function showAiHome(context: YuristimBotContext, language: Language): Promise<void> {
  const entry = await context.yuristimApi.enterAi(context.from!.id);
  await editOrReply(context, homeText(language, entry.conversation, entry.status.balance.total), {
    reply_markup: aiHomeKeyboard(language, entry.conversation.mode),
  });
}

export async function showAiHistory(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  const conversations = await context.yuristimApi.getAiConversations(context.from!.id);
  await editOrReply(
    context,
    conversations.length ? t(language, 'aiHistoryTitle') : t(language, 'aiNoChats'),
    { reply_markup: aiHistoryKeyboard(language, conversations) },
  );
}

export async function showAiConversation(
  context: YuristimBotContext,
  language: Language,
  conversationId: string,
): Promise<void> {
  const conversation = await context.yuristimApi.resumeAiConversation(
    context.from!.id,
    conversationId,
  );
  const history = await context.yuristimApi.getAiConversation(context.from!.id, conversationId);
  const completed = history.messages
    .filter((message) => message.status === 'completed' && message.content)
    .slice(-6)
    .map((message) => `${message.role === 'user' ? '👤' : '🤖'} ${message.content}`)
    .join('\n\n');
  const body = completed ? `${conversation.title}\n\n${completed}` : t(language, 'aiChatOpened');
  const chunks = telegramChunks(body);
  await editOrReply(context, chunks[0] ?? t(language, 'aiChatOpened'), {
    reply_markup: aiHomeKeyboard(language, conversation.mode),
  });
  for (const chunk of chunks.slice(1)) await context.reply(chunk);
}

export async function switchAiMode(
  context: YuristimBotContext,
  language: Language,
  mode: 'fast' | 'expert',
): Promise<void> {
  const status = await context.yuristimApi.getAiStatus(context.from!.id);
  if (!status.activeConversationId) {
    await showAiHome(context, language);
    return;
  }
  const conversation = await context.yuristimApi.switchAiMode(
    context.from!.id,
    status.activeConversationId,
    mode,
  );
  await editOrReply(context, `${t(language, 'aiModeChanged')}\n\n${t(language, 'aiPrompt')}`, {
    reply_markup: aiHomeKeyboard(language, conversation.mode),
  });
}

export async function startNewAiConversation(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  const status = await context.yuristimApi.getAiStatus(context.from!.id);
  const conversation = await context.yuristimApi.createAiConversation(
    context.from!.id,
    status.mode,
  );
  await editOrReply(context, t(language, 'aiChatOpened'), {
    reply_markup: aiHomeKeyboard(language, conversation.mode),
  });
}

export async function sendAiPrompt(
  context: YuristimBotContext,
  language: Language,
  conversationId: string,
  content: string,
  idempotencyKey: string,
): Promise<void> {
  const progress = await context.reply(t(language, 'aiWorking'));
  let result: Awaited<ReturnType<typeof context.yuristimApi.sendAiMessage>> | undefined;
  try {
    result = await context.yuristimApi.sendAiMessage(
      context.from!.id,
      conversationId,
      content,
      idempotencyKey,
    );
  } catch (error) {
    await context.api.editMessageText(
      context.chat!.id,
      progress.message_id,
      aiErrorText(language, error),
    );
    return;
  }

  const answer = `${t(language, 'aiReady')}\n\n${result.message.content}\n\n💳 ${t(
    language,
    'aiCreditsCharged',
  )}: ${credits(result.message.chargedCredits)}`;
  const chunks = telegramChunks(answer);
  try {
    await context.api.editMessageText(
      context.chat!.id,
      progress.message_id,
      chunks[0] ?? t(language, 'aiReady'),
    );
    for (const chunk of chunks.slice(1)) await context.reply(chunk);
  } catch (error) {
    await context.yuristimApi
      .reportAiDeliveryFailure(context.from!.id, result.message.id)
      .catch(() => undefined);
    throw error;
  }
}

export async function showAiFileRedirect(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  await context.reply(t(language, 'aiFileWebOnly'), {
    reply_markup: aiFileRedirectKeyboard(language, context.botConfig.miniAppUrl),
  });
}

export function telegramChunks(value: string, limit = 3_800): string[] {
  if (value.length <= limit) return [value];
  const chunks: string[] = [];
  let remaining = value;
  while (remaining.length > limit) {
    let boundary = remaining.lastIndexOf('\n\n', limit);
    if (boundary < Math.floor(limit * 0.5)) boundary = remaining.lastIndexOf('\n', limit);
    if (boundary < Math.floor(limit * 0.5)) boundary = remaining.lastIndexOf(' ', limit);
    if (boundary < 1) boundary = limit;
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function aiErrorText(language: Language, error: unknown): string {
  if (!(error instanceof YuristimApiError)) return t(language, 'apiError');
  switch (error.code) {
    case 'INSUFFICIENT_CREDITS':
      return t(language, 'aiInsufficient');
    case 'AI_CONVERSATION_BUSY':
      return t(language, 'aiBusy');
    case 'AI_PROVIDER_NOT_CONFIGURED':
      return t(language, 'aiProviderNotConfigured');
    case 'AI_PROVIDER_TIMEOUT':
      return t(language, 'aiTimeout');
    case 'AI_PROVIDER_RATE_LIMIT':
    case 'AI_PROVIDER_UNAVAILABLE':
      return t(language, 'aiProviderUnavailable');
    default:
      return t(language, 'apiError');
  }
}
