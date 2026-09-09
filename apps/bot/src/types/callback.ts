import { LANGUAGES, USER_ROLES } from '@yuristim/types';

const staticCallbacks = [
  'onboarding:continue',
  'onboarding:reset',
  'terms:accept',
  'nav:main',
  'nav:services',
  'nav:settings',
  'nav:questions',
  'nav:ai',
  'nav:balance',
  'service:find-lawyer',
  'service:document-samples',
  'service:legal-library',
  'service:create-document',
  'settings:profile',
  'settings:role',
  'settings:language',
  'settings:pin',
  'settings:documents',
  'settings:notifications',
  'settings:lawyer-profile',
  'settings:about',
  'settings:logout',
  'questions:ai',
  'questions:support',
  'questions:suggestion',
  'questions:complaint',
  'questions:faq',
] as const;

export type CallbackData =
  | (typeof staticCallbacks)[number]
  | `lang:${(typeof LANGUAGES)[number]}`
  | `role:${(typeof USER_ROLES)[number]}`;

const validCallbacks = new Set<string>([
  ...staticCallbacks,
  ...LANGUAGES.map((language) => `lang:${language}`),
  ...USER_ROLES.map((role) => `role:${role}`),
]);

export function parseCallbackData(value: string): CallbackData | null {
  return value.length <= 64 && validCallbacks.has(value) ? (value as CallbackData) : null;
}
