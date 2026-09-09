# Telegram Bot Core

## Architecture

Bot grammY transport adapteri bo‘lib, business state'ni o‘zi saqlamaydi:

```text
Telegram → apps/bot → HMAC internal API → apps/api → @yuristim/db → Supabase
```

`apps/bot` Supabase SDK, database credentials yoki service-role key ishlatmaydi.
`YuristimApiClient` base URL, request ID, besh soniyalik timeout, error mapping va
timestamped HMACni markazlashtiradi.

## `/start` va onboarding

`/start` Telegram `ctx.from.id`dan identity oladi va idempotent user ensure qiladi.
Yangi user darhol kerakli bosqichga, completed user main menu'ga, unfinished user
esa Continue/Reset ekraniga o‘tadi. Reset account, Telegram ID va DUIDni saqlaydi.

Persistent state:

1. `language_selection` — uz/ru/en;
2. `role_selection` — user/lawyer intention;
3. `name_required` — faqat lawyer uchun F.I.Sh.;
4. `terms_acceptance` — oferta qabul qilish;
5. `completed` — User main menu.

Lawyer intention `active_mode=user` holatini saqlaydi. Lawyer menu renderer mavjud,
ammo faqat backend `active_mode=lawyer` qaytarganda ishlatiladi; verification Phase
4'ga qoldirilgan.

## Menyular va navigatsiya

Main menu Reply Keyboard (RK), ichki Services/Settings/Questions sahifalari Inline
Keyboard (IK) bilan ishlaydi. Inline navigatsiyada imkon qadar message edit qilinadi;
main menu'ga qaytishda yangi RK message yuboriladi. Hali tayyor bo‘lmagan feature'lar
faqat localized shell qaytaradi va fake balance, URL yoki business data yaratmaydi.

## i18n va callback convention

Barcha user-facing matnlar `uz`, `ru`, `en` dictionarylarida. Default fallback —
Uzbek. Compile-time dictionary shape va runtime key parity testi mavjud.

Callbacklar qisqa va allowlist qilingan: `lang:uz`, `role:user`, `terms:accept`,
`nav:services`, `settings:profile`. 64 baytdan uzun yoki ro‘yxatda bo‘lmagan callback
rad etiladi. Telegram user ID callbackdan emas, doim `ctx.from.id`dan olinadi.

## Security va failure UX

- Bot → API har so‘rovi body+timestamp HMAC bilan imzolanadi.
- F.I.Sh. whitespace normalization bilan 2–160 belgi oralig‘ida tekshiriladi.
- Blocked user alohida localized javob oladi.
- API stack trace, secret, token yoki raw response Telegramga yuborilmaydi.
- PIN Telegram chatda kiritilmaydi yoki ko‘rsatilmaydi.
- Telegram duplicate actionlari idempotent backend amallaridan foydalanadi.

## Local run

Root `.env`da `TELEGRAM_BOT_TOKEN`, `API_BASE_URL` va API bilan bir xil
`INTERNAL_BOT_API_SECRET`ni sozlang. Ixtiyoriy real qiymatlar:
`PUBLIC_OFFER_URL`, `PRIVACY_URL`, `SUPPORT_USERNAME`.

```bash
pnpm --filter @yuristim/api dev
pnpm --filter @yuristim/bot dev
```

## Testing

```bash
pnpm --filter @yuristim/bot test
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Testlar new/returning/unfinished/blocked `/start`, user va lawyer onboarding, reset,
uch til, menus, callback validation, HMAC, timeout, error mapping va malformed API
response holatlarini qamraydi.
