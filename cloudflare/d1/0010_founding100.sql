CREATE TABLE founding100_reservations (
 id TEXT PRIMARY KEY NOT NULL,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
 idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 8 AND 128),
 source TEXT NOT NULL DEFAULT 'direct' CHECK(length(source) BETWEEN 1 AND 64 AND source NOT GLOB '*[^a-z0-9_-]*'),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','confirmed','expired','released')),
 user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL,confirmed_at TEXT,released_at TEXT,
 CHECK((status='reserved' AND user_id IS NULL AND confirmed_at IS NULL AND released_at IS NULL)
   OR (status='confirmed' AND user_id IS NOT NULL AND confirmed_at IS NOT NULL AND released_at IS NULL)
   OR (status='expired' AND user_id IS NULL AND confirmed_at IS NULL)
   OR (status='released' AND confirmed_at IS NULL AND released_at IS NOT NULL)),
 CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX founding100_one_confirmed_per_user_idx ON founding100_reservations(user_id) WHERE status='confirmed';
CREATE INDEX founding100_active_reservations_idx ON founding100_reservations(expires_at) WHERE status='reserved';
CREATE INDEX founding100_status_idx ON founding100_reservations(status,created_at);
CREATE TRIGGER founding100_capacity_guard BEFORE INSERT ON founding100_reservations
WHEN NEW.status='reserved'
BEGIN SELECT RAISE(ABORT,'founding100 capacity reached') WHERE (
  SELECT count(*) FROM founding100_reservations WHERE status='confirmed'
    OR (status='reserved' AND expires_at>NEW.created_at))>=100; END;
CREATE TRIGGER founding100_confirm_guard BEFORE UPDATE OF status ON founding100_reservations
WHEN NEW.status='confirmed' AND OLD.status<>'confirmed'
BEGIN
 SELECT RAISE(ABORT,'reservation unavailable') WHERE OLD.status<>'reserved' OR OLD.expires_at<=NEW.confirmed_at;
 SELECT RAISE(ABORT,'user already confirmed') WHERE EXISTS(SELECT 1 FROM founding100_reservations
   WHERE user_id=NEW.user_id AND status='confirmed');
END;

CREATE TABLE founding100_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_name TEXT NOT NULL CHECK(event_name IN ('beta_page_view','beta_cta_click','beta_slot_reserved','telegram_opened','telegram_start','beta_confirmed','onboarding_complete')),
 reservation_id TEXT REFERENCES founding100_reservations(id) ON DELETE SET NULL,
 source TEXT NOT NULL DEFAULT 'direct' CHECK(length(source) BETWEEN 1 AND 64 AND source NOT GLOB '*[^a-z0-9_-]*'),
 dedupe_key TEXT UNIQUE CHECK(dedupe_key IS NULL OR length(dedupe_key) BETWEEN 8 AND 160),
 visitor_hash TEXT CHECK(visitor_hash IS NULL OR (length(visitor_hash)=64 AND visitor_hash NOT GLOB '*[^a-f0-9]*')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX founding100_events_name_created_idx ON founding100_events(event_name,created_at DESC);
CREATE INDEX founding100_events_reservation_idx ON founding100_events(reservation_id,created_at) WHERE reservation_id IS NOT NULL;
CREATE INDEX founding100_events_visitor_created_idx ON founding100_events(visitor_hash,created_at DESC) WHERE visitor_hash IS NOT NULL;

-- Public ingress is an insert-only façade; accepted events are copied to private events.
CREATE TABLE founding100_public_event_ingress (
 event_name TEXT NOT NULL CHECK(event_name IN ('beta_page_view','beta_cta_click','telegram_opened')),
 source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 64 AND source NOT GLOB '*[^a-z0-9_-]*'),
 visitor_hash TEXT NOT NULL CHECK(length(visitor_hash)=64 AND visitor_hash NOT GLOB '*[^a-f0-9]*'),
 occurrence_id TEXT NOT NULL CHECK(length(occurrence_id)=36)
);
CREATE TRIGGER founding100_public_event_process BEFORE INSERT ON founding100_public_event_ingress
BEGIN
 INSERT INTO founding100_events(event_name,source,dedupe_key,visitor_hash,created_at)
 SELECT NEW.event_name,NEW.source,'public:'||NEW.event_name||':'||NEW.occurrence_id,
   NEW.visitor_hash,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE (SELECT count(*) FROM founding100_events WHERE visitor_hash=NEW.visitor_hash
   AND event_name IN ('beta_page_view','beta_cta_click','telegram_opened')
   AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))<240
 ON CONFLICT(dedupe_key) DO NOTHING;
 SELECT RAISE(IGNORE);
END;
