# Database

## Migration source of truth

`supabase/migrations` ichidagi SQL fresh Supabase/PostgreSQL database'ni to‘liq
quradi. `supabase/config.toml` local CLI config, generated TypeScript schema esa
`packages/db/src/database.types.ts`da saqlanadi.

## Phase 2 clean reset

Ulangan Yuristim project saqlab qolindi va eski prototype obyektlari migrationdan
oldin tozalandi: public business tables/views/functions/triggers/policies, eski
prototype Auth userlari, Storage object/bucket metadatasi va eski migration history.
Supabase boshqaradigan system schema va extensionlar o‘chirilmadi. Reset faqat
aniq Yuristim projectda bajarildi.

## Core jadvallar

- `users`: Telegram-rooted identity, DUID, onboarding, hashed PIN va terms.
- `auth_sessions`: hashed server session, expiry/revoke/last-seen.
- `auth_login_requests`: hashed one-time Telegram challenge state machine.
- `user_tags`: faqat server boshqaradigan metadata taglari.

`users.telegram_user_id`, `users.duid`, session token hash va challenge hash unique.
Session user/expiry hamda login status/expiry uchun indexlar mavjud. `updated_at`
private trigger function orqali avtomatik yangilanadi.

## Access model

Barcha core business tablelarda RLS yoqilgan va forced. Client role'lari uchun
policy yo‘q, `anon`/`authenticated` table privilege'lari revoke qilingan. Faqat
server-side API service-role client orqali `packages/db` repository bilan query
qiladi. Web va Bot database'ga bevosita business query yubormaydi.

## Test va o‘zgartirish

```bash
supabase db reset
supabase test db
supabase gen types typescript --local > packages/db/src/database.types.ts
```

Shared projectga destructive `db reset` qilinmaydi. Schema o‘zgarishi yangi,
versionlangan migration bilan kiritiladi va TypeScript types qayta generatsiya
qilinadi.
