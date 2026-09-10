# Yuristim

Yuristim — O‘zbekiston fuqarolari va bizneslari uchun yuridik yordam, huquqiy
hujjatlar va professional yuristlarni yagona platformada birlashtiruvchi LegalTech
ekotizimi. Repository Phase 4 doirasida database/core auth foundationi, multilingual
Telegram Bot hamda lawyer profile va verification lifecycle'ni o‘z ichiga oladi;
marketplace, payment, credits va AI keyingi fazalarga qoldirilgan.

## Arxitektura

Yuristim **modular monolith first, microservices later** prinsipida quriladi. Web,
Mini App va Bot Supabase'ga to‘g‘ridan-to‘g‘ri business write qilmaydi:

```text
Web / Mini App ─┐
Telegram Bot ───┼──> Fastify API ──> @yuristim/db ──> Supabase/PostgreSQL
Future Admin ───┘
```

Core auth Telegram identity, bir martalik login challenge, Argon2id PIN va
server-controlled sessionlardan foydalanadi. Batafsil:
[architecture](docs/architecture.md), [authentication](docs/authentication.md) va
[database](docs/database.md). Bot tafsilotlari: [telegram-bot](docs/telegram-bot.md).
Lawyer review va deployment: [lawyer verification](docs/lawyer-verification.md),
[deployment](docs/deployment.md).

## Monorepo strukturasi

```text
.
├── apps/
│   ├── api/       # Fastify API va core auth
│   ├── bot/       # grammY transport adapteri
│   └── web/       # Next.js App Router
├── packages/
│   ├── ai/        # Kelajakdagi AI Gateway boundary
│   ├── config/    # Typed environment helpers
│   ├── db/        # Supabase client va repository boundary
│   ├── types/     # Shared TypeScript contractlar
│   └── ui/        # Reusable React komponentlar
├── supabase/       # Versionlangan migrations va database testlar
├── docs/
└── .github/workflows/
```

## Talablar

- Node.js 24+
- pnpm 11.19+
- Supabase CLI 2.117+ (migration yaratish va local DB testlari uchun)
- Bot runtime uchun Telegram token

## O‘rnatish

```bash
git clone https://github.com/diyorbeknematov28042007-dotcom/Yuristim09092026.git
cd Yuristim09092026
git checkout phase/04-lawyer-verification
corepack enable
pnpm install --frozen-lockfile
```

## Environment

```bash
cp .env.example .env
```

API uchun `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET` va `INTERNAL_BOT_API_SECRET`
majburiy. Bot API bilan bir xil `INTERNAL_BOT_API_SECRET` ishlatadi.
`ADMIN_BOOTSTRAP_USERNAME` va `ADMIN_BOOTSTRAP_PASSWORD` faqat birinchi adminni
xavfsiz bootstrap qilish zarur bo‘lganda juft holda beriladi. Bot uchun
`ADMIN_TELEGRAM_ID` majburiy; `PUBLIC_OFFER_URL`, `PRIVACY_URL` va
`SUPPORT_USERNAME` faqat real qiymat mavjud bo‘lganda beriladi. Secretlar faqat
local/hosting environmentida saqlanadi; `NEXT_PUBLIC_*`dan boshqa qiymat browser
bundle'ga kiritilmaydi.

## Development

```bash
pnpm dev
```

Alohida app:

```bash
pnpm --filter @yuristim/web dev
pnpm --filter @yuristim/api dev
pnpm --filter @yuristim/bot dev
```

Default Web `http://localhost:3000`, API `http://localhost:3001`; health va
readiness endpointlari `/health` hamda `/ready`.

## Build va test

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

Database migration va local pgTAP test:

```bash
supabase db reset
supabase test db
```

## App'lar

- **Web:** responsive Next.js skeleton va approved lawyer uchun API-first `/[duid]`
  public profil route'i.
- **API:** health/readiness, Core User API, Telegram auth challenge, PIN,
  HttpOnly session, lawyer verification/admin review va HMAC-protected Bot
  endpointlari.
- **Bot:** grammY transport; `/start`, persistent onboarding, uch tilli RK/IK,
  settings/profile, persistent lawyer verification, multi-specialization, private
  fayl upload va mode switch. Barcha business state imzolangan internal API orqali
  yuradi; database'ga bevosita kirmaydi.

## Deployment

- **Vercel / Web:** root `apps/web`; build
  `cd ../.. && pnpm --filter @yuristim/web... build`.
- **Railway / API:** config `apps/api/railway.toml`; build
  `pnpm --filter @yuristim/api... build`; start
  `pnpm --filter @yuristim/api start`; healthcheck `/health`.
- **Railway / Bot:** config `apps/bot/railway.toml`; build
  `pnpm --filter @yuristim/bot... build`; start
  `pnpm --filter @yuristim/bot start`.
- **Supabase:** `supabase/migrations` production schema source of truth.

Production secretlar faqat tegishli platforma environment sozlamalarida beriladi.

## Contribution va workflow

1. `phase/*`, `feat/*`, `fix/*` yoki `docs/*` branchda ishlang.
2. Conventional Commit formatida kichik, mazmunli commitlar yozing.
3. Barcha validation commandlarini ishga tushiring.
4. Pull request ochib CI yashil bo‘lishini kuting.
5. Protected branchni chetlab o‘tmang va force push qilmang.

Local workflow: [docs/development.md](docs/development.md).
