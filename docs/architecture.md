# Yuristim arxitekturasi

## Asosiy qaror

Yuristim **modular monolith first, microservices later** modelida qoladi. Web,
Telegram Bot va API alohida deploy qilinadi, lekin business qoidalar yagona API
application ichidagi aniq modullarda boshqariladi.

## Boundary'lar

```text
Telegram Bot ─┐
Web/Mini App ─┼──> Yuristim API ──> packages/db ──> Supabase/PostgreSQL
Admin ────────┘            └──────> packages/ai (kelajakda)
```

- `apps/web` server secret saqlamaydi va faqat API contractlardan foydalanadi.
- `apps/bot` Telegram transport adapteridir. User ensure va challenge confirmation
  so‘rovlari vaqt belgili HMAC bilan API'ga yuboriladi.
- `apps/api` identity, authorization, validation, session va database access uchun
  yagona ishonch boundary'sidir.
- `packages/db` barcha business querylarni repository interfeysi ortida jamlaydi.
- `packages/types` secret bo‘lmagan transport contractlarini beradi.
- `packages/ai` Phase 2'da providersiz kelajak boundary bo‘lib qoladi.

## Core auth oqimi

Web `/auth/telegram/start` orqali opaque challenge oladi. Telegram Bot ayni
challenge va Telegram identity'ni internal HMAC endpoint orqali tasdiqlaydi. Web
challenge'ni bir marta consume qilib HttpOnly session cookie oladi. Database raw
challenge yoki raw session tokenni emas, HMAC-SHA-256 hashni saqlaydi.

Telegram `user.id` root identity va database'da unique. Username faqat yangilanib
turuvchi metadata. DUID Telegram ID va UUID'dan mustaqil provisional public
identifier. PIN 4 raqamli string bo‘lib, Argon2id hash sifatida saqlanadi.

## Data va security boundary

Private business tablelarda RLS `ENABLE` va `FORCE` qilingan. `anon` va
`authenticated` role'lariga table privilege berilmaydi; faqat serverdagi
service-role API repository orqali ishlaydi. Service-role key Web yoki
`NEXT_PUBLIC_*` configga hech qachon kirmaydi.

Lawyer niyati saqlanishi mumkin, ammo `active_mode=lawyer` Phase 4 verification
bo‘lmaguncha API tomonidan rad etiladi. Marketplace, credit, payment va AI modeli
Phase 2 scope'iga kirmaydi.

## Deployment boundary

- Web → Vercel
- API va Bot → Railway
- Database/Auth/Storage → Supabase

Har runtime o‘z environmentiga ega; shared source bitta pnpm/Turborepo monorepoda.
