import type {
  Language,
  MarketplaceAcceptanceView,
  MarketplaceDraftView,
  MarketplacePostView,
  SpecializationView,
} from '@yuristim/types';
import { InlineKeyboard } from 'grammy';
import { t } from '../i18n/index.js';

export function marketplaceUserKeyboard(language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'marketplaceNewRequest'), 'mp:new')
    .row()
    .text(t(language, 'marketplaceMyRequests'), 'mp:mine')
    .row()
    .text(t(language, 'back'), 'nav:main');
}

export function marketplaceSpecializationsKeyboard(
  items: SpecializationView[],
  language: Language,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items) keyboard.text(item.name, `mp:spec:${item.code}`).row();
  return keyboard.text(t(language, 'cancel'), 'mp:cancel-draft');
}

export function marketplaceDraftKeyboard(
  draft: MarketplaceDraftView,
  language: Language,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (draft.step === 'region')
    keyboard.text(t(language, 'marketplaceSkip'), 'mp:skip-region').row();
  if (draft.step === 'additional_details')
    keyboard.text(t(language, 'marketplaceSkip'), 'mp:skip-details').row();
  if (draft.step === 'preview')
    keyboard.text(t(language, 'marketplaceConfirm'), 'mp:confirm').row();
  if (draft.step !== 'specialization') keyboard.text(t(language, 'back'), 'mp:back').row();
  return keyboard.text(t(language, 'cancel'), 'mp:cancel-draft');
}

export function marketplaceRequestsKeyboard(
  items: MarketplacePostView[],
  language: Language,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items.slice(0, 10)) {
    keyboard
      .text(`${item.specializationName} · ${item.status}`, `mp:view:${item.publicIdentifier}`)
      .row();
  }
  return keyboard.text(t(language, 'back'), 'nav:main');
}

export function marketplaceRequestKeyboard(
  post: MarketplacePostView,
  language: Language,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (post.acceptanceCount > 0)
    keyboard
      .text(t(language, 'marketplaceAcceptances'), `mp:accepted:${post.publicIdentifier}`)
      .row();
  if (post.status === 'open')
    keyboard
      .text(t(language, 'marketplaceCancelRequest'), `mp:cancel:${post.publicIdentifier}`)
      .row();
  if (post.status === 'selected')
    keyboard.text(t(language, 'marketplaceReview'), `mp:review:${post.publicIdentifier}`).row();
  return keyboard.text(t(language, 'back'), 'mp:mine');
}

export function marketplaceAcceptancesKeyboard(
  post: MarketplacePostView,
  items: MarketplaceAcceptanceView[],
  language: Language,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (post.status === 'open') {
    for (const item of items.filter((entry) => entry.status === 'accepted')) {
      keyboard
        .text(
          `${t(language, 'marketplaceSelect')} · ${item.lawyer.fullName}`,
          `mp:select:${post.publicIdentifier}:${item.id}`,
        )
        .row();
    }
  }
  return keyboard.text(t(language, 'back'), `mp:view:${post.publicIdentifier}`);
}

export function marketplaceListingKeyboard(
  publicIdentifier: string,
  language: Language,
): InlineKeyboard {
  return new InlineKeyboard().text(
    t(language, 'marketplaceAccept'),
    `mp:accept:${publicIdentifier}`,
  );
}

export function marketplaceReviewKeyboard(publicIdentifier: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let rating = 1; rating <= 5; rating += 1)
    keyboard.text(`${rating}⭐`, `mp:rate:${publicIdentifier}:${rating}`);
  return keyboard;
}

export function lawyerDiscoveryKeyboard(channelUrl: string, language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .url(t(language, 'marketplaceOpenChannel'), channelUrl)
    .row()
    .text(t(language, 'back'), 'nav:main');
}

export function lawyerMarketplaceKeyboard(channelUrl: string, language: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(language, 'acceptUnits'), 'credits:accepts')
    .row()
    .text(t(language, 'marketplaceMyAcceptances'), 'mp:dashboard')
    .row()
    .url(t(language, 'marketplaceOpenChannel'), channelUrl)
    .row()
    .text(t(language, 'back'), 'nav:main');
}
