-- D1 port of lawyer verification/admin tables. Monetary prices are integer UZS hundredths.
CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE CHECK (length(username) BETWEEN 3 AND 64 AND username NOT GLOB '*[^a-z0-9_.-]*'),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','support')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts BETWEEN 0 AND 10),
  locked_until TEXT, last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS lawyer_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','draft','submitted','pending_review','approved','rejected','resubmitted')),
  region TEXT, experience_years INTEGER CHECK (experience_years BETWEEN 0 AND 70),
  bio TEXT CHECK (bio IS NULL OR length(bio) BETWEEN 20 AND 1000),
  consultation_price_minor INTEGER CHECK (consultation_price_minor IS NULL OR consultation_price_minor >= 0),
  public_slug TEXT NOT NULL UNIQUE, profile_image_path TEXT,
  rating_average_hundredths INTEGER NOT NULL DEFAULT 0 CHECK (rating_average_hundredths BETWEEN 0 AND 500),
  rating_count INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  jobs_count INTEGER NOT NULL DEFAULT 0 CHECK (jobs_count >= 0),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS specializations (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 2 AND 64 AND substr(code,1,1) GLOB '[a-z]' AND code NOT GLOB '*[^a-z0-9_]*'),
  name_uz TEXT NOT NULL, name_ru TEXT NOT NULL, name_en TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS lawyer_specializations (
  lawyer_id TEXT NOT NULL REFERENCES lawyer_profiles(id) ON DELETE CASCADE,
  specialization_id TEXT NOT NULL REFERENCES specializations(id) ON DELETE RESTRICT,
  PRIMARY KEY (lawyer_id,specialization_id)
);
CREATE INDEX IF NOT EXISTS lawyer_specializations_specialization_id_idx ON lawyer_specializations(specialization_id,lawyer_id);
CREATE TABLE IF NOT EXISTS lawyer_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  lawyer_id TEXT NOT NULL REFERENCES lawyer_profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('initial','profile_update')),
  submitted_data TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(submitted_data) AND json_type(submitted_data)='object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','pending_review','approved','rejected')),
  reject_reason TEXT CHECK (reject_reason IS NULL OR length(trim(reject_reason)) BETWEEN 3 AND 1000),
  reviewed_by TEXT REFERENCES admin_accounts(id), submitted_at TEXT, reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((status IN ('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status NOT IN ('approved','rejected') AND reviewed_by IS NULL AND reviewed_at IS NULL)),
  CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS lawyer_verifications_one_open_request ON lawyer_verifications(lawyer_id) WHERE status IN ('draft','submitted','pending_review');
CREATE INDEX IF NOT EXISTS lawyer_verifications_review_queue ON lawyer_verifications(status,submitted_at DESC) WHERE status IN ('submitted','pending_review');
CREATE INDEX IF NOT EXISTS lawyer_verifications_reviewed_by_idx ON lawyer_verifications(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE TABLE IF NOT EXISTS verification_documents (
  id TEXT PRIMARY KEY NOT NULL,
  verification_id TEXT NOT NULL REFERENCES lawyer_verifications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('profile_image','verification_document')),
  storage_bucket TEXT NOT NULL CHECK (storage_bucket IN ('profile-images','lawyer-verification')),
  storage_path TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((kind='profile_image' AND storage_bucket='profile-images') OR (kind='verification_document' AND storage_bucket='lawyer-verification'))
);
CREATE INDEX IF NOT EXISTS verification_documents_verification_id_idx ON verification_documents(verification_id);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY NOT NULL, admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT, CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_id_idx ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY NOT NULL, actor_type TEXT NOT NULL CHECK (actor_type IN ('admin','system')),
  actor_id TEXT, action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 128),
  entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 128), entity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata) AND json_type(metadata)='object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type,entity_id,created_at DESC);
CREATE TABLE IF NOT EXISTS admin_login_logs (
  id TEXT PRIMARY KEY NOT NULL, admin_id TEXT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  username TEXT NOT NULL, success INTEGER NOT NULL CHECK (success IN (0,1)), ip TEXT,
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS admin_login_logs_username_idx ON admin_login_logs(username,created_at DESC);
CREATE INDEX IF NOT EXISTS admin_login_logs_admin_id_idx ON admin_login_logs(admin_id) WHERE admin_id IS NOT NULL;
INSERT INTO specializations (id,code,name_uz,name_ru,name_en) VALUES
 ('00000000-0000-4000-8000-000000000001','civil','Fuqarolik huquqi','Гражданское право','Civil law'),
 ('00000000-0000-4000-8000-000000000002','criminal','Jinoyat huquqi','Уголовное право','Criminal law'),
 ('00000000-0000-4000-8000-000000000003','family','Oila huquqi','Семейное право','Family law'),
 ('00000000-0000-4000-8000-000000000004','labor','Mehnat huquqi','Трудовое право','Labor law'),
 ('00000000-0000-4000-8000-000000000005','administrative','Ma’muriy huquq','Административное право','Administrative law'),
 ('00000000-0000-4000-8000-000000000006','economic','Iqtisodiy huquq','Экономическое право','Economic law'),
 ('00000000-0000-4000-8000-000000000007','tax','Soliq huquqi','Налоговое право','Tax law'),
 ('00000000-0000-4000-8000-000000000008','corporate','Korporativ huquq','Корпоративное право','Corporate law'),
 ('00000000-0000-4000-8000-000000000009','contract','Shartnoma huquqi','Договорное право','Contract law'),
 ('00000000-0000-4000-8000-000000000010','real_estate','Ko‘chmas mulk huquqi','Право недвижимости','Real estate law'),
 ('00000000-0000-4000-8000-000000000011','inheritance','Meros huquqi','Наследственное право','Inheritance law'),
 ('00000000-0000-4000-8000-000000000012','intellectual_property','Intellektual mulk huquqi','Интеллектуальная собственность','Intellectual property law')
ON CONFLICT(code) DO UPDATE SET name_uz=excluded.name_uz,name_ru=excluded.name_ru,name_en=excluded.name_en,active=1;
CREATE TRIGGER IF NOT EXISTS lawyer_verification_sync_insert AFTER INSERT ON lawyer_verifications
WHEN NEW.type='initial'
BEGIN UPDATE lawyer_profiles SET verification_status=CASE
  WHEN NEW.status='draft' THEN 'draft'
  WHEN NEW.status IN ('submitted','pending_review') THEN 'pending_review'
  ELSE verification_status END WHERE id=NEW.lawyer_id; END;
CREATE TRIGGER IF NOT EXISTS lawyer_verification_sync_update AFTER UPDATE OF status ON lawyer_verifications
WHEN NEW.type='initial' AND NEW.status IN ('submitted','pending_review')
BEGIN UPDATE lawyer_profiles SET verification_status='pending_review' WHERE id=NEW.lawyer_id; END;
CREATE TRIGGER IF NOT EXISTS lawyer_verification_restore_after_cancel AFTER DELETE ON lawyer_verifications
WHEN OLD.type='initial' AND OLD.status='draft'
BEGIN UPDATE lawyer_profiles SET verification_status=COALESCE((SELECT CASE
  WHEN status='approved' THEN 'approved' WHEN status='rejected' THEN 'rejected'
  WHEN status IN ('submitted','pending_review') THEN 'pending_review' ELSE 'draft' END
  FROM lawyer_verifications WHERE lawyer_id=OLD.lawyer_id AND type='initial'
  ORDER BY created_at DESC LIMIT 1),'unverified') WHERE id=OLD.lawyer_id; END;
CREATE TRIGGER IF NOT EXISTS lawyer_verification_snapshot_guard BEFORE UPDATE ON lawyer_verifications
WHEN OLD.status <> 'draft' AND (NEW.submitted_data IS NOT OLD.submitted_data OR NEW.type IS NOT OLD.type)
BEGIN SELECT RAISE(ABORT,'submitted verification snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_logs_update_guard BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT,'audit records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_logs_delete_guard BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT,'audit records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS admin_login_logs_update_guard BEFORE UPDATE ON admin_login_logs
BEGIN SELECT RAISE(ABORT,'audit records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS admin_login_logs_delete_guard BEFORE DELETE ON admin_login_logs
BEGIN SELECT RAISE(ABORT,'audit records are immutable'); END;
