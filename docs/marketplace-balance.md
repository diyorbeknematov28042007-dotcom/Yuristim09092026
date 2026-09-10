# Marketplace accept balance

Marketplace acceptance units are deliberately separate from AI/document credits.
`marketplace_accept_transactions` is an immutable integer ledger keyed by lawyer profile;
positive rows grant units and `usage` rows spend one unit. Optional expiry supports future
packages, while the Phase 5 single-unit product does not expire.

The seeded active product is one accept for 9,900 UZS. Monthly packages are not seeded
because their prices are not yet part of the product source of truth.

Approved lawyers can use:

- `GET /marketplace/accept-balance`;
- `GET /marketplace/accept-products`.

Unverified users receive `LAWYER_NOT_VERIFIED`. Phase 6 will connect this balance to
actual listing acceptance; Phase 5 does not create marketplace posts or acceptance
business logic.
