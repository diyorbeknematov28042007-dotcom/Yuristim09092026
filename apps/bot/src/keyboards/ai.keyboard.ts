import type { AiConversationView, AiMode, Language } from '@yuristim/types';
import { InlineKeyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function aiHomeKeyboard(language: Language, mode: AiMode): InlineKeyboard {
  const switchLabel =
    mode === 'fast' ? t(language, 'aiSwitchToExpert') : t(language, 'aiSwitchToFast');
  const switchMode = mode === 'fast' ? 'expert' : 'fast';
  return new InlineKeyboard()
    .text(switchLabel, `ai:mode:${switchMode}`)
    .row()
    .text(t(language, 'aiNewChat'), 'ai:new')
    .text(t(language, 'aiHistory'), 'ai:history')
    .row()
    .text(t(language, 'aiExit'), 'ai:back');
}

export function aiHistoryKeyboard(
  language: Language,
  conversations: AiConversationView[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const conversation of conversations.slice(0, 10)) {
    const title = Array.from(conversation.title).slice(0, 32).join('');
    keyboard.text(title, `ai:open:${conversation.id}`).row();
  }
  return keyboard.text(t(language, 'back'), 'nav:ai');
}

export function aiFileRedirectKeyboard(language: Language, miniAppUrl?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (miniAppUrl) keyboard.url(t(language, 'openMiniApp'), miniAppUrl).row();
  return keyboard.text(t(language, 'back'), 'nav:ai');
}
