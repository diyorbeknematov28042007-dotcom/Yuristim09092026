# Development qo‘llanmasi

## Local setup

```bash
nvm use
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

Real key va tokenlar faqat local `.env` yoki deployment environmentida saqlanadi.

## Environment

### API (server-only)

- `NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET` — kamida 32 belgili HMAC secret
- `INTERNAL_BOT_API_SECRET` — kamida 32 belgili Bot/API shared secret
- `SESSION_TTL_SECONDS` — default 30 kun
- `LOGIN_CHALLENGE_TTL_SECONDS` — default 10 daqiqa

### Bot (server-only)

- `TELEGRAM_BOT_TOKEN`
- `API_BASE_URL`
- `INTERNAL_BOT_API_SECRET`

### Web (public)

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Web kodiga service role yoki boshqa server-only variable import qilish taqiqlanadi.

## Commandlar

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format
pnpm format:check
```

Workspace misollari:

```bash
pnpm --filter @yuristim/api test
pnpm --filter @yuristim/web build
pnpm --filter @yuristim/bot typecheck
```

## Database workflow

Yangi migration faqat Supabase CLI bilan yaratiladi:

```bash
supabase migration new descriptive_name
```

Local database'ni qayta qurish va pgTAP testlarni ishga tushirish:

```bash
supabase db reset
supabase test db
```

Migrationni edit qilgandan keyin database types qayta generatsiya qilinadi. Remote
projectga migration Git'dagi ayni SQL bilan qo‘llanadi. Production yoki shared
projectga `db reset` ishlatilmaydi.

## Branching

- Fazalar: `phase/NN-name`
- Feature: `feat/short-name`
- Fix: `fix/short-name`
- Docs: `docs/short-name`

Phase 2 branchi Phase 1 PR merge qilinmaganligi sababli
`phase/01-foundation`dan ajratilgan. Commitlar Conventional Commits formatida;
history rewrite va force push taqiqlanadi.

## Testing

- API: Fastify `inject` bilan auth/user/internal endpoint integration testlari.
- Auth service: DUID collision, PIN lock, challenge consume va session lifecycle.
- Database: repository contract unit testlari va `supabase/tests/database` pgTAP.
- Bot: polling boshlamasdan module import va API adapter typecheck.
- Web: strict typecheck va production build.

Automated testlar real Telegram yoki production secret talab qilmasligi kerak.
