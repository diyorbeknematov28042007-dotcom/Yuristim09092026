# Deployment

## Railway target

The staging topology uses one Railway project named `Yuristim` with two services:

- `yuristim-api`, configured by `apps/api/railway.toml`, public HTTP and `/health`
  healthcheck;
- `yuristim-bot`, configured by `apps/bot/railway.toml`, long-running grammY polling.

Both services build from the repository root so pnpm workspace dependencies are
available. Set each Railway service's config file path to its corresponding
`railway.toml` file.

API environment names:

```text
NODE_ENV
PORT
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SESSION_SECRET
INTERNAL_BOT_API_SECRET
SESSION_TTL_SECONDS
LOGIN_CHALLENGE_TTL_SECONDS
ADMIN_SESSION_TTL_SECONDS
ADMIN_BOOTSTRAP_USERNAME (optional)
ADMIN_BOOTSTRAP_PASSWORD (optional)
PAYMENT_WEBHOOK_SECRET
WEEKLY_CREDIT_JOB_INTERVAL_SECONDS
```

Bot environment names:

```text
NODE_ENV
TELEGRAM_BOT_TOKEN
ADMIN_TELEGRAM_ID
API_BASE_URL
INTERNAL_BOT_API_SECRET
PUBLIC_OFFER_URL (optional)
PRIVACY_URL (optional)
SUPPORT_USERNAME (optional)
TERMS_VERSION
API_TIMEOUT_MILLISECONDS
```

`INTERNAL_BOT_API_SECRET` must be the same cryptographically random value on both
services. `API_BASE_URL` points to the deployed API URL. Secret values belong only
in Railway environment settings and must not be committed or printed.

`PAYMENT_WEBHOOK_SECRET` belongs only to the API service. The default weekly scheduler
interval is 3600 seconds; it executes once at startup and then periodically. Weekly
grant uniqueness is enforced in PostgreSQL, so restarts or multiple API instances do
not create duplicate grants.

## Supabase

`supabase/migrations` is the schema source of truth. Apply migrations in order, then
run security/performance advisors. Verification buckets remain private; no service
role key is exposed to Bot or Web.

## Vercel

`apps/web` is the Vercel project root. Configure `NEXT_PUBLIC_API_URL` to the public
Railway API and deploy as Preview first. The public lawyer route is `/[duid]`. Do not
attach or redirect a production domain during Phase 4.

## Post-deploy checks

1. Confirm API `/health` and `/ready` return 200.
2. Confirm the Bot reaches that API with timestamped method/path/body HMAC.
3. Run the User and Lawyer Telegram smoke flows.
4. Submit a test verification, approve it through the admin API, switch to lawyer
   mode and load the public DUID route.
5. Remove isolated test records if the environment is retained.
6. Confirm balance/history, an admin bonus, sandbox checkout, a signed paid webhook,
   and a duplicate webhook that does not grant value twice.
