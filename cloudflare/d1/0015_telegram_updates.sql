-- Webhook deduplication and per-chat serialization. No update JSON or message
-- content is stored; failed/expired claims may be retried.
CREATE TABLE telegram_update_claims (
 update_id INTEGER PRIMARY KEY NOT NULL CHECK(update_id>=0),
 chat_id INTEGER,
 lease_id TEXT NOT NULL CHECK(length(lease_id)=36),
 status TEXT NOT NULL CHECK(status IN ('processing','failed','completed')),
 attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 20),
 lease_until TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX telegram_update_one_chat_processing
 ON telegram_update_claims(chat_id) WHERE chat_id IS NOT NULL AND status='processing';
CREATE INDEX telegram_update_claim_expiry ON telegram_update_claims(status,lease_until);
