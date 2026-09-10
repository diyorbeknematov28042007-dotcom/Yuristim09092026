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
  'credits:buy',
  'credits:history',
  'credits:accepts',
  'credits:all-plans',
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
  'verify:start',
  'verify:edit',
  'verify:back',
  'verify:cancel',
  'verify:spec-done',
  'verify:price-skip',
  'verify:submit',
  'lawyer:mode',
  'user:mode',
] as const;

export type CallbackData =
  | (typeof staticCallbacks)[number]
  | `lang:${(typeof LANGUAGES)[number]}`
  | `role:${(typeof USER_ROLES)[number]}`
  | `verify:spec:${string}`;

const validCallbacks = new Set<string>([
  ...staticCallbacks,
  ...LANGUAGES.map((language) => `lang:${language}`),
  ...USER_ROLES.map((role) => `role:${role}`),
]);

export function parseCallbackData(value: string): CallbackData | null {
  if (value.length > 64) return null;
  if (/^verify:spec:[a-z][a-z0-9_]{1,40}$/.test(value)) return value as CallbackData;
  return validCallbacks.has(value) ? (value as CallbackData) : null;
}
