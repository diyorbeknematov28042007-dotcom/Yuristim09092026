-- Integer milli-credits and integer UZS hundredths avoid floating-point balances.
-- D1 is only reachable through the trusted Worker; never bind it to a public client.
CREATE TABLE credit_transactions (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 type TEXT NOT NULL CHECK(type IN ('purchase','welcome_bonus','weekly_bonus','student_bonus','admin_bonus','ai_usage','document_usage','refund','adjustment','reversal')),
 bucket_type TEXT NOT NULL CHECK(bucket_type IN ('paid','weekly','bonus')),
 amount_milli INTEGER NOT NULL CHECK(amount_milli <> 0 AND abs(amount_milli) <= 99999999999999),
 balance_after_milli INTEGER NOT NULL CHECK(balance_after_milli BETWEEN 0 AND 99999999999999),
 source TEXT CHECK(source IS NULL OR length(source) BETWEEN 1 AND 80),
 reference_id TEXT CHECK(reference_id IS NULL OR length(reference_id) BETWEEN 1 AND 160),
 expires_at TEXT,
 reason TEXT CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 1000),
 created_by TEXT REFERENCES admin_accounts(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((bucket_type='paid' AND expires_at IS NULL) OR (bucket_type='weekly' AND expires_at IS NOT NULL) OR bucket_type='bonus'),
 CHECK((source IS NULL AND reference_id IS NULL) OR (source IS NOT NULL AND reference_id IS NOT NULL))
);
CREATE INDEX credit_transactions_user_history_idx ON credit_transactions(user_id,created_at DESC,id DESC);
CREATE INDEX credit_transactions_user_expiry_idx ON credit_transactions(user_id,expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX credit_transactions_created_by_idx ON credit_transactions(created_by) WHERE created_by IS NOT NULL;
CREATE UNIQUE INDEX credit_transactions_idempotency_idx ON credit_transactions(user_id,type,source,reference_id,bucket_type,coalesce(expires_at,'')) WHERE reference_id IS NOT NULL AND source IS NOT NULL;
CREATE TRIGGER credit_transactions_insert_guard BEFORE INSERT ON credit_transactions
BEGIN
 SELECT RAISE(ABORT,'expired credit allocation') WHERE NEW.expires_at IS NOT NULL AND NEW.expires_at <= NEW.created_at;
 SELECT RAISE(ABORT,'credit balance mismatch') WHERE NEW.balance_after_milli <>
   coalesce((SELECT sum(amount_milli) FROM credit_transactions WHERE user_id=NEW.user_id AND (expires_at IS NULL OR expires_at > NEW.created_at)),0) + NEW.amount_milli;
 SELECT RAISE(ABORT,'insufficient bucket credits') WHERE NEW.amount_milli < 0 AND
   coalesce((SELECT sum(amount_milli) FROM credit_transactions WHERE user_id=NEW.user_id AND bucket_type=NEW.bucket_type AND expires_at IS NEW.expires_at),0) < -NEW.amount_milli;
END;
CREATE TRIGGER credit_transactions_update_guard BEFORE UPDATE ON credit_transactions BEGIN SELECT RAISE(ABORT,'immutable credit ledger'); END;
CREATE TRIGGER credit_transactions_delete_guard BEFORE DELETE ON credit_transactions BEGIN SELECT RAISE(ABORT,'immutable credit ledger'); END;

CREATE TABLE credit_products (
 id TEXT PRIMARY KEY NOT NULL,
 code TEXT NOT NULL UNIQUE CHECK(length(code) BETWEEN 2 AND 64 AND substr(code,1,1) GLOB '[a-z]' AND code NOT GLOB '*[^a-z0-9_]*'),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 name_uz TEXT NOT NULL CHECK(length(name_uz) BETWEEN 1 AND 120),
 name_ru TEXT NOT NULL CHECK(length(name_ru) BETWEEN 1 AND 120),
 name_en TEXT NOT NULL CHECK(length(name_en) BETWEEN 1 AND 120),
 credit_amount_milli INTEGER CHECK(credit_amount_milli IS NULL OR credit_amount_milli > 0),
 price_minor INTEGER CHECK(price_minor IS NULL OR price_minor > 0),
 currency TEXT NOT NULL DEFAULT 'UZS' CHECK(currency='UZS'),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(active=0 OR (credit_amount_milli IS NOT NULL AND price_minor IS NOT NULL))
);
CREATE TABLE marketplace_accept_transactions (
 id TEXT PRIMARY KEY NOT NULL,
 lawyer_id TEXT NOT NULL REFERENCES lawyer_profiles(id) ON DELETE RESTRICT,
 type TEXT NOT NULL CHECK(type IN ('purchase','usage','bonus','refund','adjustment','reversal')),
 amount INTEGER NOT NULL CHECK(amount <> 0),
 balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
 expires_at TEXT,
 reference_id TEXT CHECK(reference_id IS NULL OR length(reference_id) BETWEEN 1 AND 160),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX marketplace_accept_transactions_history_idx ON marketplace_accept_transactions(lawyer_id,created_at DESC,id DESC);
CREATE INDEX marketplace_accept_transactions_expiry_idx ON marketplace_accept_transactions(lawyer_id,expires_at) WHERE expires_at IS NOT NULL;
CREATE UNIQUE INDEX marketplace_accept_transactions_idempotency_idx ON marketplace_accept_transactions(lawyer_id,type,reference_id,coalesce(expires_at,'')) WHERE reference_id IS NOT NULL;
CREATE TRIGGER marketplace_accept_transactions_insert_guard BEFORE INSERT ON marketplace_accept_transactions
BEGIN
 SELECT RAISE(ABORT,'expired accept allocation') WHERE NEW.expires_at IS NOT NULL AND NEW.expires_at <= NEW.created_at;
 SELECT RAISE(ABORT,'accept balance mismatch') WHERE NEW.balance_after <>
   coalesce((SELECT sum(amount) FROM marketplace_accept_transactions WHERE lawyer_id=NEW.lawyer_id AND (expires_at IS NULL OR expires_at > NEW.created_at)),0) + NEW.amount;
 SELECT RAISE(ABORT,'insufficient expiring accepts') WHERE NEW.amount < 0 AND
   coalesce((SELECT sum(amount) FROM marketplace_accept_transactions WHERE lawyer_id=NEW.lawyer_id AND expires_at IS NEW.expires_at),0) < -NEW.amount;
END;
CREATE TRIGGER marketplace_accept_transactions_update_guard BEFORE UPDATE ON marketplace_accept_transactions BEGIN SELECT RAISE(ABORT,'immutable accept ledger'); END;
CREATE TRIGGER marketplace_accept_transactions_delete_guard BEFORE DELETE ON marketplace_accept_transactions BEGIN SELECT RAISE(ABORT,'immutable accept ledger'); END;

CREATE TABLE marketplace_accept_products (
 id TEXT PRIMARY KEY NOT NULL,
 code TEXT NOT NULL UNIQUE CHECK(length(code) BETWEEN 2 AND 64 AND substr(code,1,1) GLOB '[a-z]' AND code NOT GLOB '*[^a-z0-9_]*'),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 name_uz TEXT NOT NULL CHECK(length(name_uz) BETWEEN 1 AND 120),
 name_ru TEXT NOT NULL CHECK(length(name_ru) BETWEEN 1 AND 120),
 name_en TEXT NOT NULL CHECK(length(name_en) BETWEEN 1 AND 120),
 accept_count INTEGER NOT NULL CHECK(accept_count > 0),
 price_minor INTEGER NOT NULL CHECK(price_minor > 0),
 currency TEXT NOT NULL DEFAULT 'UZS' CHECK(currency='UZS'),
 expires_in_days INTEGER CHECK(expires_in_days IS NULL OR expires_in_days BETWEEN 1 AND 3650),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE payments (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 provider TEXT NOT NULL CHECK(length(provider) BETWEEN 2 AND 40 AND substr(provider,1,1) GLOB '[a-z]' AND provider NOT GLOB '*[^a-z0-9_-]*'),
 provider_payment_id TEXT,
 type TEXT NOT NULL CHECK(type IN ('credits','marketplace_accepts','profile_tariff')),
 amount_money_minor INTEGER NOT NULL CHECK(amount_money_minor > 0),
 currency TEXT NOT NULL DEFAULT 'UZS' CHECK(currency='UZS'),
 status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','pending','paid','failed','cancelled')),
 product_id TEXT NOT NULL,
 product_code TEXT NOT NULL CHECK(length(product_code) BETWEEN 2 AND 64),
 product_units_milli INTEGER NOT NULL CHECK(product_units_milli > 0),
 idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 8 AND 160),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 paid_at TEXT,failed_at TEXT,
 CHECK((status='paid' AND paid_at IS NOT NULL AND failed_at IS NULL) OR
       (status IN ('failed','cancelled') AND paid_at IS NULL AND failed_at IS NOT NULL) OR
       (status IN ('created','pending') AND paid_at IS NULL AND failed_at IS NULL)),
 CHECK(type <> 'marketplace_accepts' OR product_units_milli % 1000 = 0)
);
CREATE UNIQUE INDEX payments_provider_payment_id_idx ON payments(provider,provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX payments_user_history_idx ON payments(user_id,created_at DESC);
CREATE INDEX payments_status_idx ON payments(status,created_at);
CREATE TRIGGER payment_create_guard BEFORE INSERT ON payments
BEGIN
 SELECT RAISE(ABORT,'invalid initial payment state') WHERE NEW.status<>'created' OR NEW.provider_payment_id IS NOT NULL;
 SELECT RAISE(ABORT,'credit product snapshot mismatch') WHERE NEW.type='credits' AND NOT EXISTS(
   SELECT 1 FROM credit_products WHERE id=NEW.product_id AND code=NEW.product_code
   AND active=1 AND credit_amount_milli=NEW.product_units_milli AND price_minor=NEW.amount_money_minor);
 SELECT RAISE(ABORT,'accept product snapshot mismatch') WHERE NEW.type='marketplace_accepts' AND NOT EXISTS(
   SELECT 1 FROM marketplace_accept_products WHERE id=NEW.product_id AND code=NEW.product_code
   AND active=1 AND accept_count*1000=NEW.product_units_milli AND price_minor=NEW.amount_money_minor);
END;
CREATE TRIGGER payment_transition_guard BEFORE UPDATE ON payments
BEGIN
 SELECT RAISE(ABORT,'immutable payment fields') WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.provider IS NOT OLD.provider OR NEW.type IS NOT OLD.type OR NEW.amount_money_minor IS NOT OLD.amount_money_minor OR NEW.currency IS NOT OLD.currency OR NEW.product_id IS NOT OLD.product_id OR NEW.product_code IS NOT OLD.product_code OR NEW.product_units_milli IS NOT OLD.product_units_milli OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.created_at IS NOT OLD.created_at;
 SELECT RAISE(ABORT,'payment provider reference mismatch') WHERE OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS NOT OLD.provider_payment_id;
 SELECT RAISE(ABORT,'invalid payment transition') WHERE OLD.status IN ('paid','failed','cancelled') AND NEW.status IS NOT OLD.status;
 SELECT RAISE(ABORT,'unsupported payment type') WHERE NEW.status='paid' AND OLD.status<>'paid' AND NEW.type='profile_tariff';
 SELECT RAISE(ABORT,'lawyer not verified') WHERE NEW.status='paid' AND OLD.status<>'paid' AND NEW.type='marketplace_accepts'
   AND NOT EXISTS(SELECT 1 FROM lawyer_profiles WHERE user_id=NEW.user_id AND verification_status='approved');
END;

-- A payment state change and its grant run inside the same SQLite statement.
CREATE TRIGGER payment_paid_credits AFTER UPDATE OF status ON payments WHEN NEW.status='paid' AND OLD.status<>'paid' AND NEW.type='credits'
BEGIN
 INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,source,reference_id,created_at)
 SELECT lower(hex(randomblob(16))),NEW.user_id,'purchase','paid',NEW.product_units_milli,
   coalesce((SELECT sum(amount_milli) FROM credit_transactions WHERE user_id=NEW.user_id AND (expires_at IS NULL OR expires_at > NEW.paid_at)),0)+NEW.product_units_milli,
   NEW.provider,NEW.id,NEW.paid_at;
END;
CREATE TRIGGER payment_paid_accepts AFTER UPDATE OF status ON payments WHEN NEW.status='paid' AND OLD.status<>'paid' AND NEW.type='marketplace_accepts'
BEGIN
 INSERT INTO marketplace_accept_transactions(id,lawyer_id,type,amount,balance_after,expires_at,reference_id,created_at)
 SELECT lower(hex(randomblob(16))),l.id,'purchase',NEW.product_units_milli/1000,
   coalesce((SELECT sum(amount) FROM marketplace_accept_transactions WHERE lawyer_id=l.id AND (expires_at IS NULL OR expires_at > NEW.paid_at)),0)+NEW.product_units_milli/1000,
   CASE WHEN p.expires_in_days IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',NEW.paid_at,'+'||p.expires_in_days||' days') END,
   NEW.id,NEW.paid_at FROM lawyer_profiles l JOIN marketplace_accept_products p ON p.id=NEW.product_id
   WHERE l.user_id=NEW.user_id AND l.verification_status='approved';
 SELECT RAISE(ABORT,'accept product missing') WHERE NOT EXISTS(SELECT 1 FROM marketplace_accept_products WHERE id=NEW.product_id);
END;
CREATE TRIGGER payment_audit_after_transition AFTER UPDATE OF status ON payments WHEN NEW.status IN ('paid','failed','cancelled') AND OLD.status<>NEW.status
BEGIN INSERT INTO audit_logs(id,actor_type,action,entity_type,entity_id,metadata)
 VALUES(lower(hex(randomblob(16))),'system','payment.'||NEW.status,'payment',NEW.id,json_object('provider',NEW.provider,'type',NEW.type)); END;

INSERT INTO credit_products(id,code,name,name_uz,name_ru,name_en,credit_amount_milli)
VALUES ('credits_100','credits_100','100 credits','100 kredit','100 кредитов','100 credits',100000),
 ('credits_250','credits_250','250 credits','250 kredit','250 кредитов','250 credits',250000),
 ('credits_1000','credits_1000','1000 credits','1000 kredit','1000 кредитов','1000 credits',1000000),
 ('enterprise','enterprise','Enterprise','Enterprise','Enterprise','Enterprise',NULL);
INSERT INTO marketplace_accept_products(id,code,name,name_uz,name_ru,name_en,accept_count,price_minor,active)
VALUES ('single_accept','single_accept','1 marketplace accept','1 ta e’lonni qabul qilish',
 '1 принятие объявления','1 marketplace accept',1,990000,1);

-- Existing PostgreSQL welcome grant is enforced here at insertion, independent of API retries.
CREATE TRIGGER users_grant_welcome_credit AFTER INSERT ON users
BEGIN INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,source,reference_id,reason,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,'welcome_bonus','bonus',50000,50000,'onboarding','welcome:v1','Welcome credit',NEW.created_at); END;
