import { randomUUID } from 'node:crypto';
import type { Language, MarketplaceDraftView, MarketplacePostView } from '@yuristim/types';
import type { YuristimBotContext } from '../bot.js';
import { t } from '../i18n/index.js';
import {
  lawyerDiscoveryKeyboard,
  lawyerMarketplaceKeyboard,
  marketplaceAcceptancesKeyboard,
  marketplaceDraftKeyboard,
  marketplaceListingKeyboard,
  marketplaceRequestKeyboard,
  marketplaceRequestsKeyboard,
  marketplaceReviewKeyboard,
  marketplaceSpecializationsKeyboard,
  marketplaceUserKeyboard,
} from '../keyboards/marketplace.keyboard.js';
import { editOrReply } from './navigation.service.js';

function postText(post: MarketplacePostView): string {
  return [
    '⚖️ Yangi yuridik murojaat',
    '',
    `Yo‘nalish: ${post.specializationName}`,
    `Hudud: ${post.region ?? 'Ko‘rsatilmagan'}`,
    `Muammo: ${post.description}`,
    post.additionalDetails ? `Qo‘shimcha: ${post.additionalDetails}` : '',
    '',
    `Kod: ${post.publicIdentifier}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function requestText(post: MarketplacePostView): string {
  return [
    `⚖️ ${post.specializationName}`,
    `Status: ${post.status}`,
    `Hudud: ${post.region ?? '—'}`,
    `Muammo: ${post.description}`,
    `Qabul qilganlar: ${post.acceptanceCount}/${post.maxAcceptances}`,
  ].join('\n');
}

export async function showMarketplaceUserHome(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  await editOrReply(context, t(language, 'marketplaceUserTitle'), {
    reply_markup: marketplaceUserKeyboard(language),
  });
}

export async function showMarketplaceDraft(
  context: YuristimBotContext,
  language: Language,
  draft?: MarketplaceDraftView | null,
): Promise<void> {
  if (!context.from) return;
  const current = draft ?? (await context.yuristimApi.getMarketplaceDraft(context.from.id));
  if (!current) return showMarketplaceUserHome(context, language);
  if (current.step === 'specialization') {
    const lawyer = await context.yuristimApi.getLawyerContext(context.from.id);
    await editOrReply(context, t(language, 'marketplaceChooseSpecialization'), {
      reply_markup: marketplaceSpecializationsKeyboard(lawyer.specializations, language),
    });
    return;
  }
  const prompt =
    current.step === 'description'
      ? t(language, 'marketplaceDescriptionPrompt')
      : current.step === 'region'
        ? t(language, 'marketplaceRegionPrompt')
        : current.step === 'additional_details'
          ? t(language, 'marketplaceDetailsPrompt')
          : [
              t(language, 'marketplacePreview'),
              '',
              `Yo‘nalish: ${current.specializationCode}`,
              `Hudud: ${current.region ?? '—'}`,
              `Muammo: ${current.description ?? '—'}`,
              current.additionalDetails ? `Qo‘shimcha: ${current.additionalDetails}` : '',
            ]
              .filter(Boolean)
              .join('\n');
  await editOrReply(context, prompt, { reply_markup: marketplaceDraftKeyboard(current, language) });
}

export async function publishMarketplacePost(
  context: YuristimBotContext,
  post: MarketplacePostView,
): Promise<void> {
  try {
    const username = context.me.username;
    const message = await context.api.sendMessage(
      context.botConfig.marketplaceChannelId,
      postText(post),
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '⚖️ Qabul qilish',
                url: `https://t.me/${username}?start=${post.publicIdentifier}`,
              },
            ],
          ],
        },
      },
    );
    await context.yuristimApi.recordMarketplaceChannelMessage(post.id, message.message_id);
  } catch (error) {
    await context.yuristimApi.recordMarketplaceChannelFailure(post.id).catch(() => undefined);
    throw error;
  }
}

export async function showMarketplaceRequests(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  if (!context.from) return;
  const items = await context.yuristimApi.getMarketplaceRequests(context.from.id);
  await editOrReply(
    context,
    items.length ? t(language, 'marketplaceMyRequests') : t(language, 'marketplaceNoRequests'),
    { reply_markup: marketplaceRequestsKeyboard(items, language) },
  );
}

export async function findMarketplacePost(
  context: YuristimBotContext,
  publicIdentifier: string,
): Promise<MarketplacePostView | null> {
  if (!context.from) return null;
  const items = await context.yuristimApi.getMarketplaceRequests(context.from.id);
  return items.find((item) => item.publicIdentifier === publicIdentifier) ?? null;
}

export async function showMarketplaceRequest(
  context: YuristimBotContext,
  language: Language,
  publicIdentifier: string,
): Promise<void> {
  const post = await findMarketplacePost(context, publicIdentifier);
  if (!post) return editOrReply(context, t(language, 'invalidAction'));
  await editOrReply(context, requestText(post), {
    reply_markup: marketplaceRequestKeyboard(post, language),
  });
}

export async function showMarketplaceAcceptances(
  context: YuristimBotContext,
  language: Language,
  publicIdentifier: string,
): Promise<void> {
  if (!context.from) return;
  const post = await findMarketplacePost(context, publicIdentifier);
  if (!post) return editOrReply(context, t(language, 'invalidAction'));
  const items = await context.yuristimApi.getMarketplaceAcceptances(context.from.id, post.id);
  const text = items.length
    ? items
        .map(
          (item) =>
            `✅ ${item.lawyer.fullName}\n⭐ ${item.lawyer.ratingAverage} (${item.lawyer.ratingCount})\nDUID: ${item.lawyer.duid}`,
        )
        .join('\n\n')
    : t(language, 'marketplaceNoAcceptances');
  await editOrReply(context, text, {
    reply_markup: marketplaceAcceptancesKeyboard(post, items, language),
  });
}

export async function showMarketplaceListing(
  context: YuristimBotContext,
  language: Language,
  publicIdentifier: string,
): Promise<void> {
  const post = await context.yuristimApi.getMarketplaceListing(publicIdentifier, language);
  if (post.status !== 'open' || post.acceptanceCount >= post.maxAcceptances) {
    await editOrReply(
      context,
      `${requestText(post)}\n\n${t(language, 'marketplaceListingClosed')}`,
    );
    return;
  }
  await editOrReply(context, requestText(post), {
    reply_markup: marketplaceListingKeyboard(publicIdentifier, language),
  });
}

export async function showLawyerDiscovery(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  await context.reply(t(language, 'marketplaceFindClientsText'), {
    reply_markup: lawyerDiscoveryKeyboard(context.botConfig.marketplaceChannelUrl, language),
  });
}

export async function showLawyerMarketplace(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  if (!context.from) return;
  const dashboard = await context.yuristimApi.getMarketplaceDashboard(context.from.id);
  const balance = await context.yuristimApi.getAcceptBalance(context.from.id);
  const text = [
    t(language, 'marketplaceCabinet'),
    '',
    `${t(language, 'acceptUnits')}: ${balance.balance}`,
    `${t(language, 'marketplaceMyAcceptances')}: ${dashboard.items.length}`,
    `Selected: ${dashboard.selected}`,
    `Closed: ${dashboard.closed}`,
  ].join('\n');
  await context.reply(text, {
    reply_markup: lawyerMarketplaceKeyboard(context.botConfig.marketplaceChannelUrl, language),
  });
}

export async function confirmMarketplaceDraft(
  context: YuristimBotContext,
  language: Language,
): Promise<void> {
  if (!context.from) return;
  const post = await context.yuristimApi.confirmMarketplaceDraft(
    context.from.id,
    `telegram:${context.from.id}:${randomUUID()}`,
  );
  await publishMarketplacePost(context, post);
  await editOrReply(context, `${t(language, 'marketplacePublished')}\n\n${requestText(post)}`, {
    reply_markup: marketplaceRequestKeyboard(post, language),
  });
}

export async function editMarketplaceChannelStatus(
  context: YuristimBotContext,
  post: MarketplacePostView,
  statusText: string,
): Promise<void> {
  if (!post.telegramChannelMessageId) return;
  await context.api
    .editMessageText(
      context.botConfig.marketplaceChannelId,
      post.telegramChannelMessageId,
      `${statusText}\n\n${postText(post)}`,
    )
    .catch(() => undefined);
}

export async function showMarketplaceReview(
  context: YuristimBotContext,
  language: Language,
  publicIdentifier: string,
): Promise<void> {
  await editOrReply(context, t(language, 'marketplaceReviewPrompt'), {
    reply_markup: marketplaceReviewKeyboard(publicIdentifier),
  });
}
