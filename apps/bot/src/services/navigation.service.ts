import type { BotUserContext, Language } from '@yuristim/types';
import type { Context } from 'grammy';
import type { BotRuntimeConfig } from '../config/runtime.js';
import { t } from '../i18n/index.js';
import {
  backKeyboard,
  languageKeyboard,
  roleKeyboard,
  termsKeyboard,
} from '../keyboards/common.keyboard.js';
import { mainLawyerKeyboard } from '../keyboards/main-lawyer.keyboard.js';
import { mainUserKeyboard } from '../keyboards/main-user.keyboard.js';
import { displayName } from './user-context.service.js';

export async function editOrReply(
  context: Context,
  text: string,
  replyMarkup?: Parameters<Context['editMessageText']>[1],
): Promise<void> {
  if (context.callbackQuery?.message) {
    try {
      await context.editMessageText(text, replyMarkup);
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes('message is not modified')) return;
    }
  }
  await context.reply(text, replyMarkup);
}

export async function showOnboardingStep(
  context: Context,
  data: BotUserContext,
  config: BotRuntimeConfig,
): Promise<void> {
  const language = data.user.language ?? 'uz';
  switch (data.user.onboardingStatus) {
    case 'language_selection':
      await editOrReply(context, t(null, 'chooseLanguage'), { reply_markup: languageKeyboard() });
      return;
    case 'role_selection':
      await editOrReply(context, t(language, 'chooseRole'), {
        reply_markup: roleKeyboard(language),
      });
      return;
    case 'name_required':
      await editOrReply(context, t(language, 'namePrompt'));
      return;
    case 'terms_acceptance': {
      const offer = config.publicOfferUrl
        ? `${t(language, 'termsIntro')}\n\n${config.publicOfferUrl}`
        : `${t(language, 'termsIntro')}\n\n${t(language, 'termsUnavailable')}`;
      await editOrReply(context, offer, { reply_markup: termsKeyboard(language) });
      return;
    }
    case 'completed':
      await showMainMenu(context, data);
  }
}

export async function showMainMenu(context: Context, data: BotUserContext): Promise<void> {
  const language = data.user.language ?? 'uz';
  const keyboard =
    data.user.activeMode === 'lawyer' ? mainLawyerKeyboard(language) : mainUserKeyboard(language);
  await context.reply(t(language, 'mainTitle'), { reply_markup: keyboard });
}

export function profileText(data: BotUserContext): string {
  const { user } = data;
  const language: Language = user.language ?? 'uz';
  const username = user.telegramUsername ? `\nTelegram: @${user.telegramUsername}` : '';
  return [
    t(language, 'profileTitle'),
    '',
    `${t(language, 'displayName')}: ${displayName(user)}`,
    `DUID: ${user.duid}${username}`,
    `${t(language, 'language')}: ${language}`,
    `${t(language, 'registeredAt')}: ${user.createdAt.slice(0, 10)}`,
    `${t(language, 'selectedRole')}: ${user.onboardingRole ?? 'user'}`,
    `${t(language, 'activeMode')}: ${user.activeMode}`,
  ].join('\n');
}

export function aboutText(language: Language, config: BotRuntimeConfig): string {
  const offer = config.publicOfferUrl ?? t(language, 'termsUnavailable');
  const privacy = config.privacyUrl ?? t(language, 'privacyUnavailable');
  const support = config.supportUsername
    ? `@${config.supportUsername}`
    : t(language, 'supportUnavailable');
  return `${t(language, 'aboutText')}\n\nPublic offer: ${offer}\nPrivacy: ${privacy}\nSupport: ${support}`;
}

export function shellBack(
  language: Language,
  text: string,
  destination: 'nav:questions' | 'nav:services' | 'nav:settings',
) {
  return { text, options: { reply_markup: backKeyboard(language, destination) } };
}
