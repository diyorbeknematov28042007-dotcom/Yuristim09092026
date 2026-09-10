# Payments

## Provider boundary

`PaymentService` depends on `PaymentProviderAdapter`. Phase 5 ships a `sandbox` adapter
because no production provider has been selected. It creates a real pending payment
record but no fake external checkout URL. Click, Payme, or another provider can be added
behind the same interface without changing ledger rules.

`POST /payments/checkout` accepts a credit or marketplace-accept product and requires an
`Idempotency-Key` header. The payment snapshots product code, price, currency, and units
at checkout. Only active, complete products are sellable. `GET /payments/:id` is limited
to the payment owner or a separately authenticated admin.

## State machine

Payments start as `pending` after checkout and can become `paid`, `failed`, or
`cancelled` after a verified webhook. Terminal timestamps are protected by a database
constraint. A terminal payment cannot transition to a different state.

## Webhook and exactly-once value

`POST /webhooks/payments/:provider` verifies a provider-specific signature before any
database mutation. The sandbox adapter uses HMAC-SHA-256 over the canonical payment ID,
provider payment ID, and target status. Its secret is server-only.

The database function locks the payment row, validates the provider and provider
reference, changes state, appends the credit or accept ledger transaction, and writes an
audit event in one transaction. The unique provider reference, checkout idempotency key,
and payment-to-ledger reference prevent double value. Repeating a valid webhook returns
`processed: false`; failed and cancelled payments grant nothing.

Refund provider calls are intentionally outside Phase 5. Financial correction is already
modeled as immutable `refund` or `reversal` ledger transactions, never transaction
deletion.

## Configuration

`PAYMENT_WEBHOOK_SECRET` must be a cryptographically random Railway secret. No real
provider secret is required until a provider is selected. Never expose this secret to
the Bot, Web, logs, or repository.
