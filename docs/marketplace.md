# Marketplace

Phase 6 adds an anonymized Telegram marketplace on top of the Phase 5 marketplace-accept ledger.

## Lifecycle

- A user completes a persistent draft, previews it, and confirms it.
- Confirmation creates one idempotent `open` post with an opaque `mp_…` identifier.
- The bot publishes only public-safe fields to the configured Telegram channel.
- An approved lawyer follows the deep link and accepts the post. The database function locks the
  post, validates eligibility and capacity, appends exactly one accept-ledger debit, and creates one
  acceptance in the same transaction.
- Up to five lawyers may accept. The owner can select any accepted lawyer immediately.
- Selection closes the post, marks the winning acceptance, prevents further acceptance, and enables
  one 1–5 review for the selected lawyer.
- An owner may cancel only an open post. Expired, selected, and cancelled posts reject acceptance.

Telegram publication and participant notifications are best effort after the database transaction.
Failures are logged/recorded and never undo a valid marketplace transaction.

## Configuration

The API keeps using the existing Supabase and HMAC variables. The bot additionally requires:

```dotenv
MARKETPLACE_CHANNEL_ID=-1003512004134
MARKETPLACE_CHANNEL_URL=https://t.me/yuristim_marketplace
```

The bot must be a channel administrator with permission to post and edit its own messages. The bot
username is resolved from Telegram at runtime; it is not hardcoded.

## Security model

- Public posts and callbacks use random opaque identifiers; UUIDs and Telegram IDs are not exposed.
- API user routes authenticate sessions and enforce ownership/role rules.
- Bot routes reuse the existing signed HMAC transport and replay protection.
- Marketplace tables have forced RLS and explicit deny policies for direct clients.
- Mutating database functions are executable only by `service_role`.
- Unique constraints and row locks protect create, accept, selection, and review idempotency.
- Accept failures do not debit the ledger. If a later system operation ever needs compensation, the
  Phase 5 append-only reversal transaction is used; balances are never overwritten.

## Scope

This phase intentionally does not add private chat, a web marketplace, CRM/case management, or the
Phase 13 notification center.
