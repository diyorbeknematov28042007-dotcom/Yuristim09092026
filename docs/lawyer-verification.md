# Lawyer Profile and Verification

## Boundary

Phase 4 lawyer workflow is API-first. Telegram Bot and Web never read or write
Supabase business tables directly:

```text
Bot / Web -> Fastify API -> @yuristim/db -> Supabase/PostgreSQL + Storage
```

Marketplace, payments, credits, reviews and AI remain outside this phase.

## Schema

- `lawyer_profiles` keeps the currently approved public profile and aggregate
  placeholders. `user_id` and `public_slug` are unique; the slug is the user's DUID.
- `specializations` contains 12 localized MVP categories.
- `lawyer_specializations` is a unique many-to-many relation.
- `lawyer_verifications` keeps immutable submitted snapshots for `initial` and
  `profile_update` reviews.
- `verification_documents` stores metadata for randomly named Storage objects.
- `admin_accounts` and `admin_sessions` are isolated from user auth.
- `audit_logs` and `admin_login_logs` are append-only.

All private Phase 4 tables have RLS enabled and forced. Browser roles receive no
direct table grants. The server-side API uses the service role only inside the DB
package boundary.

## Verification lifecycle

Initial verification moves through `unverified -> draft -> pending_review ->
approved|rejected`. A rejected snapshot remains in history; resubmission creates a
new record. Cancelling a draft restores the previous stable status and never deletes
the Yuristim user, DUID or lawyer profile.

The Telegram draft stores the current step and validated values in
`submitted_data`, so a Bot restart does not lose progress. Required inputs are full
name, region, at least one active specialization, 0–70 experience years, a 20–1000
character bio, profile image and verification document. Consultation price is
optional and uses non-negative UZS numeric storage.

An approved lawyer's professional edit creates a `profile_update` snapshot. The old
approved profile remains public until an admin approves the proposed snapshot.

## Admin review

Admin auth uses a separate HttpOnly session cookie. Passwords use Argon2id; raw
passwords and raw session tokens are never persisted. Optional first-admin bootstrap
requires both `ADMIN_BOOTSTRAP_USERNAME` and `ADMIN_BOOTSTRAP_PASSWORD` environment
variables.

Approve/reject calls lock the verification row and run through the
`review_lawyer_verification` database transaction. Approval updates the snapshot,
public profile, specializations, verification timestamp, user capability and audit
entry atomically. A second concurrent decision returns
`VERIFICATION_ALREADY_REVIEWED`. Rejection requires a non-empty reason.

## Storage

- `lawyer-verification`: private verification documents.
- `profile-images`: private source profile images exposed only through short-lived
  API-generated signed URLs.

Allowed upload types are PDF, JPEG and PNG, with a 5 MB per-file limit. The API
checks declared MIME type, decoded size and magic bytes; filenames never determine
trust or storage paths. Admin detail and approved public profile responses receive
time-limited signed URLs. Permanent public verification-document URLs do not exist.

## Public access

`GET /lawyers/:duid` and `GET /lawyers` return approved profiles only. Search is
paginated and supports region, specialization, minimum experience and a bounded sort
allowlist. Private verification snapshots and documents are excluded.

The Web route `/[duid]` fetches this public API. Unapproved or missing profiles use a
privacy-safe not-found response.
