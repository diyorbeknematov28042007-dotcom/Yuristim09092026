import type { AiMode, BotAiRuntimeView, Language } from '@yuristim/types';
import type { YuristimBotContext } from '../bot.js';
import { YuristimApiError } from '../api/yuristim-api.client.js';
import { t } from '../i18n/index.js';
import {
  aiFileRedirectKeyboard,
  aiHistoryKeyboard,
  aiHomeKeyboard,
} from '../keyboards/ai.keyboard.js';
import { currentBotCorrelationId, recordBotPerformance } from '../observability/performance.js';
import { editOrReply } from './navigation.service.js';

function credits(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function homeText(language: Language, aiMode: AiMode, balance: number): string {
  const mode = aiMode === 'fast' ? t(language, 'aiModeFast') : t(language, 'aiModeExpert');
  return [
    t(language, 'aiTitle'),
    '',
    `${t(language, 'aiCurrentMode')}: ${mode} · ${credits(balance)} ${t(language, 'aiCreditUnit')}`,
  ].join('\n');
}

async function deleteControllerMessage(
  context: YuristimBotContext,
  messageId: number,
): Promise<void> {
  try {
    await context.api.deleteMessage(context.chat!.id, messageId);
    return;
  } catch {
    try {
      await context.api.editMessageReplyMarkup(context.chat!.id, messageId, {
        reply_markup: { inline_keyboard: [] },
      });
      return;
    } catch {
      console.warn('Telegram AI controller cleanup failed', {
        messageId,
        correlationId: currentBotCorrelationId(),
      });
    }
  }
}

async function detachController(
  context: YuristimBotContext,
  messageId: number | null,
): Promise<void> {
  if (messageId === null) return;
  try {
    const claimed = await context.yuristimApi.replaceAiController(
      context.from!.id,
      messageId,
      null,
    );
    if (claimed) await deleteControllerMessage(context, messageId);
  } catch {
    console.warn('Telegram AI controller state cleanup failed', {
      messageId,
      correlationId: currentBotCorrelationId(),
    });
  }
}

async function publishController(context: YuristimBotContext, language: Language): Promise<void> {
  try {
    let status = await context.yuristimApi.getAiStatus(context.from!.id);
    if (status.telegramControlMessageId !== null) {
      await detachController(context, status.telegramControlMessageId);
      status = await context.yuristimApi.getAiStatus(context.from!.id);
    }
    const message = await context.reply(homeText(language, status.mode, status.balance.total), {
      reply_markup: aiHomeKeyboard(language, status.mode),
    });
    const persisted = await context.yuristimApi.replaceAiController(
      context.from!.id,
      status.telegramControlMessageId,
      message.message_id,
    );
    if (!persisted) await deleteControllerMessage(context, message.message_id);
  } catch {
    console.warn('Telegram AI controller publish failed', {
      correlationId: currentBotCorrelationId(),
    });
  }
}

async function sendStatusSticker(
  context: YuristimBotContext,
  mode: AiMode,
): Promise<number | null> {
  const fileId =
    mode === 'fast'
      ? context.botConfig.aiFastStickerFileId
      : context.botConfig.aiExpertStickerFileId;
  if (fileId) {
    try {
      const sticker = await context.replyWithSticker(fileId);
      return sticker.message_id;
    } catch {
      console.warn('Telegram AI status sticker send failed', {
        mode,
        correlationId: currentBotCorrelationId(),
      });
    }
  }
  try {
    const indicator = await context.reply(mode === 'fast' ? '✨' : '💥');
    return indicator.message_id;
  } catch {
    await context.api.sendChatAction(context.chat!.id, 'typing').catch(() => undefined);
  }
  return null;
}

async function deleteStatusSticker(
  context: YuristimBotContext,
  messageId: number | null,
): Promise<boolean> {
  if (messageId === null) return true;
  try {
    await context.api.deleteMessage(context.chat!.id, messageId);
    return true;
  } catch {
    console.warn('Telegram AI status sticker cleanup failed', {
      messageId,
      correlationId: currentBotCorrelationId(),
    });
    return false;
  }
}

export async function showAiHome(context: YuristimBotContext, language: Language): Promise<void> {
  const entry = await context.yuristimApi.enterAi(context.from!.id);
  await detachController(context, entry.status.telegramControlMessageId);
  await publishController(context, language);
}

export async function showAiHistory(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  const status = await context.yuristimApi.getAiStatus(context.from!.id);
  await detachController(context, status.telegramControlMessageId);
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
  const status = await context.yuristimApi.getAiStatus(context.from!.id);
  await detachController(context, status.telegramControlMessageId);
  const conversation = await context.yuristimApi.resumeAiConversation(
    context.from!.id,
    conversationId,
  );
  const history = await context.yuristimApi.getAiConversation(context.from!.id, conversationId);
  const completed = history.messages
    .filter((message) => message.status === 'completed' && message.content)
    .slice(-6)
    .map(
      (message) =>
        `${message.role === 'user' ? '👤' : '🤖'} ${
          message.role === 'assistant' ? telegramPlainText(message.content) : message.content
        }`,
    )
    .join('\n\n');
  const body = completed ? `${conversation.title}\n\n${completed}` : t(language, 'aiChatOpened');
  const chunks = telegramChunks(body);
  await editOrReply(context, chunks[0] ?? t(language, 'aiChatOpened'));
  for (const chunk of chunks.slice(1)) await context.reply(chunk);
  await publishController(context, language);
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
  await detachController(context, status.telegramControlMessageId);
  await context.yuristimApi.switchAiMode(context.from!.id, status.activeConversationId, mode);
  await context.reply(`${t(language, 'aiModeChanged')}\n\n${t(language, 'aiPrompt')}`);
  await publishController(context, language);
}

export async function startNewAiConversation(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  const status = await context.yuristimApi.getAiStatus(context.from!.id);
  await detachController(context, status.telegramControlMessageId);
  await context.yuristimApi.createAiConversation(context.from!.id, status.mode);
  await context.reply(t(language, 'aiChatOpened'));
  await publishController(context, language);
}

export async function sendAiPrompt(
  context: YuristimBotContext,
  language: Language,
  conversationId: string,
  content: string,
  idempotencyKey: string,
  runtime: BotAiRuntimeView,
): Promise<void> {
  const controllerCleanup = detachController(context, runtime.telegramControlMessageId);
  const statusSticker = sendStatusSticker(context, runtime.mode);
  let stickerCleanup: Promise<boolean> | undefined;
  const cleanupStatusSticker = (): Promise<boolean> => {
    stickerCleanup ??= statusSticker.then((messageId) => deleteStatusSticker(context, messageId));
    return stickerCleanup;
  };
  try {
    try {
      const result = await context.yuristimApi.sendAiMessage(
        context.from!.id,
        conversationId,
        content,
        idempotencyKey,
      );
      await cleanupStatusSticker();
      const answer = `${t(language, 'aiReady')}\n\n${telegramPlainText(result.message.content)}\n\n💳 ${t(
        language,
        'aiCreditsCharged',
      )}: ${credits(result.message.chargedCredits)}`;
      const chunks = telegramChunks(answer);
      let chunksSent = 0;
      try {
        for (const chunk of chunks) {
          await context.reply(chunk);
          chunksSent += 1;
        }
        recordBotPerformance('ai_delivery', {
          success: true,
          chunksSent,
          chunksTotal: chunks.length,
        });
      } catch {
        recordBotPerformance('ai_delivery', {
          success: false,
          chunksSent,
          chunksTotal: chunks.length,
          errorCategory: 'telegram_send_error',
        });
        try {
          await context.yuristimApi.reportAiDeliveryFailure(context.from!.id, result.message.id);
          recordBotPerformance('ai_refund', { success: true });
        } catch {
          recordBotPerformance('ai_refund', { success: false, errorCategory: 'refund_failed' });
        }
        await context.reply(t(language, 'apiError')).catch(() => undefined);
      }
    } catch (error) {
      await cleanupStatusSticker();
      await context.reply(aiErrorText(language, error));
    }
  } finally {
    await Promise.allSettled([controllerCleanup, cleanupStatusSticker()]);
    await publishController(context, language);
  }
}

export async function leaveAiChat(context: YuristimBotContext): Promise<void> {
  const status = await context.yuristimApi.getAiStatus(context.from!.id);
  await detachController(context, status.telegramControlMessageId);
  await context.yuristimApi.leaveAi(context.from!.id);
}

export async function showAiFileRedirect(
  context: YuristimBotContext,
  language: Language,
  runtime?: BotAiRuntimeView,
): Promise<void> {
  const status = runtime ?? (await context.yuristimApi.getAiStatus(context.from!.id));
  await detachController(context, status.telegramControlMessageId);
  await context.reply(t(language, 'aiFileWebOnly'), {
    reply_markup: aiFileRedirectKeyboard(language, context.botConfig.miniAppUrl),
  });
  await publishController(context, language);
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

export function telegramPlainText(value: string): string {
  return value.replaceAll('**', '');
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
