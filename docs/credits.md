# Credits

## Source of truth

`credit_transactions` is the only source of truth for a user's credit balance. Every
row is signed: grants are positive and usage is negative. Update and delete operations
are rejected by a database trigger, so corrections use a new `refund`, `adjustment`, or
`reversal` row instead of rewriting history.

Balances are calculated from the unexpired ledger by `credit_balance`; there is no
mutable balance cache to drift from the ledger. `balance_after` is an audit-friendly
snapshot produced while the per-user advisory transaction lock is held.

## Buckets and debit order

Credits live in one of three buckets:

1. `weekly`: always expiring;
2. `bonus`: expiry is optional;
3. `paid`: never expiring.

Debit allocation is atomic and uses this order: weekly, expiring bonus (earliest expiry
first), non-expiring bonus, then paid. Non-expiring bonus is intentionally used before
paid so purchased value is preserved for the user. Amounts use `numeric(14,3)`, allowing
fractional future charges without floating-point arithmetic.

## Grants

- A future user insert triggers one `+50` `welcome_bonus` row. The stable
  `onboarding/welcome:v1` reference and unique index make retries idempotent. Existing
  users are not retroactively backfilled by the migration.
- `grant_weekly_credits` gives every active user `+12` once per product week.
- Admin bonus grants require an admin, positive amount, reason, and idempotency key;
  the ledger row and audit log are committed together.

The product week is Monday 00:00 through the next Monday 00:00 in
`Asia/Tashkent` (UTC+5). Weekly grants expire at the next boundary. The API scheduler
runs the job at startup and then at the configured interval. Multiple API instances are
safe because database references and advisory locks enforce one grant per user/week.

## API

- `GET /credits/balance` returns total, paid, weekly, bonus, next expiry, and low/zero
  balance flags.
- `GET /credits/transactions` supports page, limit, type, and date range filters.
- `GET /credits/products` returns only active, priced products.
- `POST /admin/users/:id/credits` appends an audited `admin_bonus`; it never edits a
  balance field.

The seeded 100, 250, 1000, and Enterprise products remain inactive while prices are
unknown. No placeholder price is presented as an offer.
