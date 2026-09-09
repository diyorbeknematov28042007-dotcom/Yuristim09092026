# Yuristim

Yuristim — O‘zbekiston fuqarolari va bizneslari uchun AI yuridik yordam, huquqiy
hujjatlar va professional yuristlarni yagona platformada birlashtiruvchi LegalTech
ekotizimi.

Ushbu repository hozir **Phase 1 — Foundation** holatida. Auth, database schema, AI,
marketplace, kredit va payment business logic'i hali implementatsiya qilinmagan.

## Arxitektura

Yuristim avval modular monolith sifatida quriladi:

- Web va kelajakdagi Mini App/Admin mijozlari faqat Yuristim API orqali ishlaydi.
- Telegram Bot business amallar uchun Yuristim API'ga murojaat qiladi.
- Faqat API database, AI gateway va payment boundary'larini boshqaradi.
- Shared package'lar app'larni bir-biriga bog‘lamasdan umumiy kod beradi.
- Microservice'lar faqat real scaling ehtiyoji tug‘ilganda ajratiladi.

Batafsil: [docs/architecture.md](docs/architecture.md).

## Monorepo strukturasi

```text
.
├── apps/
│   ├── api/       # Fastify API
│   ├── bot/       # grammY Telegram Bot
│   └── web/       # Next.js App Router
├── packages/
│   ├── ai/        # Kelajakdagi AI Gateway boundary
│   ├── config/    # Typed env va umumiy config
│   ├── db/        # Database client boundary
│   ├── types/     # Shared TypeScript contractlar
│   └── ui/        # Reusable React komponentlar
├── docs/
└── .github/workflows/
```

## Talablar

- Node.js 24 yoki yuqori
- pnpm 11.19.0 yoki yuqori
- Telegram Bot'ni ishga tushirish uchun development token

Node versiyasini `.nvmrc` orqali tanlash mumkin.

## O‘rnatish

```bash
git clone https://github.com/diyorbeknematov28042007-dotcom/Yuristim09092026.git
cd Yuristim09092026
git checkout phase/01-foundation
corepack enable
pnpm install
```

CI va reproducible install uchun lockfile commit qilinadi:

```bash
pnpm install --frozen-lockfile
```

## Environment sozlash

```bash
cp .env.example .env
```

`.env.example` faqat namuna qiymatlarni saqlaydi. Real secretlar commit qilinmaydi.

Muhim ajratish:

- `SUPABASE_SERVICE_ROLE_KEY` va `TELEGRAM_BOT_TOKEN` faqat server muhitida.
- Faqat `NEXT_PUBLIC_*` o‘zgaruvchilar browser bundle'ga kirishi mumkin.
- Phase 1'da Supabase qiymatlari optional; database hali ulanmaydi.
- Bot uchun `TELEGRAM_BOT_TOKEN` majburiy.

## Development

Barcha app'larni ishga tushirish:

```bash
pnpm dev
```

Alohida app:

```bash
pnpm --filter @yuristim/web dev
pnpm --filter @yuristim/api dev
pnpm --filter @yuristim/bot dev
```

Default manzillar:

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- API health: `http://localhost:3001/health`
- API readiness: `http://localhost:3001/ready`

## Build va validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

Formatlash:

```bash
pnpm format
```

## App'lar

### Web

Next.js App Router asosidagi accessible va responsive landing skeleton. Kelajakda
`/app` va `/admin` route'lari shu app ichida qo‘shiladi.

### API

Fastify application creation va server startup ajratilgan. Foundation quyidagilarni
o‘z ichiga oladi:

- `GET /health`;
- `GET /ready`;
- request ID;
- structured logging;
- global error handler;
- typed environment validation.

### Bot

grammY skeleton API-first arxitekturada. Token mavjud bo‘lmasa, uning qiymatini
logga chiqarmasdan tushunarli configuration error qaytaradi. Bot database'ga
to‘g‘ridan-to‘g‘ri yozmaydi.

## Deployment overview

### Vercel — Web

- Root Directory: `apps/web`
- Install Command: `cd ../.. && pnpm install --frozen-lockfile`
- Build Command: `cd ../.. && pnpm --filter @yuristim/web... build`
- Output: Next.js avtomatik aniqlanadi

### Railway — API

- Root Directory: repository root
- Build Command: `pnpm --filter @yuristim/api... build`
- Start Command: `pnpm --filter @yuristim/api start`
- Healthcheck: `/health`

### Railway — Bot

- Root Directory: repository root
- Build Command: `pnpm --filter @yuristim/bot... build`
- Start Command: `pnpm --filter @yuristim/bot start`

Deployment secrets faqat hosting platformaning environment sozlamalarida saqlanadi.

## Contribution va workflow

1. `main`dan `phase/*`, `feat/*`, `fix/*` yoki `docs/*` branch yarating.
2. Kichik va mazmunli Conventional Commit yozing.
3. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` bilan tekshiring.
4. Pull request oching va CI yashil bo‘lishini kuting.
5. Protected branch yoki history'ni force push bilan chetlab o‘tmang.

Local ish jarayoni: [docs/development.md](docs/development.md).
