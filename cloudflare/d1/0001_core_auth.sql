-- Yuristim v2: independent D1 staging schema, ported from the core auth PostgreSQL migration.
-- Application code must use bound parameters and enforce actor ownership; D1 has no RLS.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  telegram_user_id INTEGER NOT NULL UNIQUE CHECK (telegram_user_id > 0),
  telegram_username TEXT,
  telegram_first_name TEXT,
  full_name TEXT CHECK (full_name IS NULL OR length(trim(full_name)) BETWEEN 2 AND 160),
  language TEXT CHECK (language IS NULL OR language IN ('uz', 'ru', 'en')),
  active_mode TEXT NOT NULL DEFAULT 'user' CHECK (active_mode IN ('user', 'lawyer')),
  onboarding_role TEXT CHECK (onboarding_role IS NULL OR onboarding_role IN ('user', 'lawyer')),
  onboarding_status TEXT NOT NULL DEFAULT 'language_selection'
    CHECK (onboarding_status IN ('language_selection', 'role_selection', 'name_required', 'active')),
  duid TEXT NOT NULL UNIQUE CHECK (length(duid) = 19 AND substr(duid, 1, 3) = 'yr_'),
  pin_hash TEXT,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (pin_failed_attempts BETWEEN 0 AND 5),
  pin_locked_until TEXT,
  terms_accepted_at TEXT,
  terms_version TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT lawyer_name_required CHECK (onboarding_role <> 'lawyer' OR full_name IS NOT NULL),
  CONSTRAINT terms_acceptance_complete CHECK (
    (terms_accepted_at IS NULL AND terms_version IS NULL)
    OR (terms_accepted_at IS NOT NULL AND terms_version IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS auth_login_requests (
  id TEXT PRIMARY KEY NOT NULL,
  challenge_hash TEXT NOT NULL UNIQUE CHECK (
    length(challenge_hash) = 64 AND challenge_hash NOT GLOB '*[^0-9a-f]*'
  ),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'consumed', 'expired', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  consumed_at TEXT,
  CHECK (expires_at > created_at),
  CHECK (status NOT IN ('confirmed', 'consumed') OR (user_id IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK (status <> 'consumed' OR consumed_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS user_tags (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (length(tag) BETWEEN 2 AND 64),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata) AND json_type(metadata) = 'object'),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, tag)
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_login_requests_status_expires_at_idx ON auth_login_requests(status, expires_at);
CREATE INDEX IF NOT EXISTS auth_login_requests_user_id_idx ON auth_login_requests(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_tags_user_id_idx ON user_tags(user_id);
CREATE INDEX IF NOT EXISTS user_tags_expires_at_idx ON user_tags(expires_at) WHERE expires_at IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS users_set_updated_at AFTER UPDATE ON users
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
