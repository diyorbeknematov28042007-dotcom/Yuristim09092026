# Development qo‘llanmasi

## Local setup

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env
```

Real key va tokenlarni faqat local `.env` yoki hosting environmentida saqlang.

## Environment

### API

- `NODE_ENV`: `development`, `test` yoki `production`
- `PORT`: default `3001`
- `HOST`: default `0.0.0.0`
- `LOG_LEVEL`: structured log darajasi
- Supabase qiymatlari Phase 1'da optional va ishlatilmaydi

### Bot

- `TELEGRAM_BOT_TOKEN`: majburiy server secret
- `API_BASE_URL`: default `http://localhost:3001`

### Web

- `NEXT_PUBLIC_API_URL`: default `http://localhost:3001`
- `NEXT_PUBLIC_SUPABASE_URL`: Phase 2 uchun optional public URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Phase 2 uchun optional publishable key

Web kodiga server-only variable import qilish taqiqlanadi.

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

Workspace filtrlash:

```bash
pnpm --filter @yuristim/api test
pnpm --filter @yuristim/web build
pnpm --filter @yuristim/bot typecheck
```

## Branching

- Fazalar: `phase/NN-name`
- Feature: `feat/short-name`
- Fix: `fix/short-name`
- Docs: `docs/short-name`

`main`ga to‘g‘ridan-to‘g‘ri force push yoki history rewrite qilinmaydi.

Commitlar Conventional Commits formatida:

```text
chore: initialize yuristim monorepo
feat(api): add fastify application foundation
feat(bot): add grammy bot foundation
feat(web): add nextjs application foundation
ci: add validation workflow
docs: add development setup
```

## Testing

- API: Fastify `inject` orqali health/readiness integration test.
- Bot: network/pollingni boshlamasdan module creation test.
- Shared config: typed env validation va secret-redaction test.
- Web: strict typecheck va production build.

Testlar real Telegram, Supabase yoki AI secretini talab qilmasligi kerak.

## Yangi modul qo‘shish qoidasi

1. Modul egasini tanlang: Web, API, Bot yoki shared package.
2. App'lararo internal import yaratmang.
3. Business logic'ni transport handler ichiga joylamang.
4. Environment qiymatini typed schema orqali o‘qing.
5. Minimal test va documentation qo‘shing.
6. Keyingi faza feature'ini oldindan implementatsiya qilmang.
