# Yuristim arxitekturasi

## Qaror

Yuristim **modular monolith first, microservices later** prinsipida quriladi. Phase
1'da bitta monorepo ichida bitta Web, bitta API va bitta Bot application mavjud.
Bu model boundary'larni aniq saqlaydi, ammo erta distributed-system murakkabligini
kiritmaydi.

## Yuqori darajadagi oqim

```text
Telegram Bot ─┐
Mini App ─────┼──> Yuristim API ──> Supabase/PostgreSQL
Web ──────────┤            ├──────> AI Gateway (kelajakda)
Admin ────────┘            └──────> Payment provider (kelajakda)
```

## App boundary'lari

### `apps/web`

- Next.js App Router frontend.
- Hozir faqat minimal landing skeleton.
- Keyinchalik `/`, `/app` va `/admin` route'larini host qiladi.
- Business write'larni database'ga bevosita yubormaydi.
- Browser faqat `NEXT_PUBLIC_*` config qiymatlarini oladi.

### `apps/api`

- Fastify asosidagi yagona backend application.
- Public va internal HTTP contractlar shu yerda boshqariladi.
- Database, AI va payment providerlariga server-side boundary shu app orqali ochiladi.
- Hozir faqat health/readiness va umumiy runtime foundation mavjud.

### `apps/bot`

- grammY asosidagi Telegram transport adapteri.
- Telegram update'larini qabul qiladi va keyingi fazalarda API'ga yuboradi.
- Supabase yoki AI providerga bevosita business write/call qilmaydi.
- Handler, middleware, keyboard va transport kodi modul sifatida ajratiladi.

## Shared package boundary'lari

- `@yuristim/types`: transportlararo TypeScript contractlar.
- `@yuristim/config`: typed env parser va umumiy konstantalar.
- `@yuristim/db`: Supabase/PostgreSQL client yaratish uchun server-safe boundary.
- `@yuristim/ai`: kelajakdagi provider-agnostic AI Gateway boundary.
- `@yuristim/ui`: Web/Mini App uchun reusable React UI.

Shared package hech qachon `apps/*` ichidan import qilmaydi. App'lar bir-birining
ichki modulini import qilmaydi; ular HTTP contract yoki shared package orqali
hamkorlik qiladi.

## API-first tamoyili

Bot, Web, Mini App va Admin bir xil business qoidalarni takrorlamaydi. Identity,
authorization, ledger, marketplace, document va AI orchestration kelajakda API
modullariga joylanadi. Bu:

- barcha clientlarda bir xil qoida;
- audit va security uchun bitta nazorat nuqtasi;
- transportlarni mustaqil rivojlantirish;
- keyinchalik zarur modulni service sifatida ajratish

imkonini beradi.

## Data boundary

Phase 1 real schema, migration, RLS yoki Supabase client yaratmaydi. `packages/db`
faqat public va server credentiallarini TypeScript darajasida ajratadigan contractni
beradi. Real database integration Phase 2'da migration va RLS bilan birga qo‘shiladi.

`SUPABASE_SERVICE_ROLE_KEY` hech qachon Web package yoki `NEXT_PUBLIC_*`
o‘zgaruvchi sifatida ishlatilmaydi.

## AI boundary

Phase 1 OpenAI, Gemini yoki Claude SDK o‘rnatmaydi. `packages/ai` faqat kelajakdagi
gateway uchun package boundary beradi. Provider routing, legal search, citation va
credit usage tegishli keyingi fazalarda implementatsiya qilinadi.

## Deployment boundary

- Web → Vercel
- API → Railway
- Bot → Railway
- Database/Storage → Supabase

Har service alohida environmentga ega bo‘ladi, lekin source va shared contractlar
bitta monorepoda qoladi.
