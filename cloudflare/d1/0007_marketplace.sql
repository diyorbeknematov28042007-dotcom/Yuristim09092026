-- Marketplace schema; D1 must be private to API/Bot Workers.
CREATE TABLE marketplace_posts (
 id TEXT PRIMARY KEY NOT NULL,
 public_id TEXT NOT NULL UNIQUE CHECK(length(public_id) BETWEEN 23 AND 51 AND substr(public_id,1,3)='mp_' AND substr(public_id,4) NOT GLOB '*[^A-Za-z0-9_-]*'),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 specialization_id TEXT REFERENCES specializations(id) ON DELETE RESTRICT,
 description TEXT CHECK(description IS NULL OR length(trim(description)) BETWEEN 20 AND 1500),
 region TEXT CHECK(region IS NULL OR length(trim(region)) BETWEEN 2 AND 120),
 additional_details TEXT CHECK(additional_details IS NULL OR length(trim(additional_details)) BETWEEN 2 AND 1500),
 language TEXT NOT NULL DEFAULT 'uz' CHECK(language IN ('uz','ru','en')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','selected','cancelled','expired')),
 draft_step TEXT NOT NULL DEFAULT 'specialization' CHECK(draft_step IN ('specialization','description','region','additional_details','preview','complete')),
 max_acceptances INTEGER NOT NULL DEFAULT 5 CHECK(max_acceptances BETWEEN 1 AND 5),
 selected_acceptance_id TEXT REFERENCES marketplace_acceptances(id) ON DELETE RESTRICT,
 channel_message_id INTEGER,
 publish_status TEXT NOT NULL DEFAULT 'pending' CHECK(publish_status IN ('pending','published','failed')),
 publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK(publish_attempts BETWEEN 0 AND 100),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
 expires_at TEXT,published_at TEXT,selected_at TEXT,cancelled_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(status='draft' OR (specialization_id IS NOT NULL AND description IS NOT NULL)),
 CHECK((status='selected' AND selected_at IS NOT NULL AND selected_acceptance_id IS NOT NULL)
   OR (status='cancelled' AND cancelled_at IS NOT NULL AND selected_acceptance_id IS NULL)
   OR (status IN ('draft','open','expired') AND selected_at IS NULL AND cancelled_at IS NULL)),
 UNIQUE(user_id,idempotency_key)
);
CREATE INDEX marketplace_posts_owner_history_idx ON marketplace_posts(user_id,created_at DESC,id DESC);
CREATE INDEX marketplace_posts_open_idx ON marketplace_posts(created_at DESC) WHERE status='open';
CREATE INDEX marketplace_posts_expiry_idx ON marketplace_posts(expires_at) WHERE status='open' AND expires_at IS NOT NULL;
CREATE INDEX marketplace_posts_selected_acceptance_idx ON marketplace_posts(selected_acceptance_id) WHERE selected_acceptance_id IS NOT NULL;
CREATE TABLE marketplace_acceptances (
 id TEXT PRIMARY KEY NOT NULL,
 public_id TEXT NOT NULL UNIQUE CHECK(length(public_id) BETWEEN 23 AND 51 AND substr(public_id,1,3)='ma_' AND substr(public_id,4) NOT GLOB '*[^A-Za-z0-9_-]*'),
 marketplace_post_id TEXT NOT NULL REFERENCES marketplace_posts(id) ON DELETE RESTRICT,
 lawyer_id TEXT NOT NULL REFERENCES lawyer_profiles(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','selected','not_selected','cancelled')),
 ledger_transaction_id TEXT NOT NULL UNIQUE REFERENCES marketplace_accept_transactions(id) ON DELETE RESTRICT,
 accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 selected_at TEXT,closed_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((status='selected' AND selected_at IS NOT NULL AND closed_at IS NULL)
   OR (status IN ('not_selected','cancelled') AND selected_at IS NULL AND closed_at IS NOT NULL)
   OR (status='accepted' AND selected_at IS NULL AND closed_at IS NULL)),
 UNIQUE(marketplace_post_id,lawyer_id)
);
CREATE INDEX marketplace_acceptances_post_idx ON marketplace_acceptances(marketplace_post_id,accepted_at,id);
CREATE INDEX marketplace_acceptances_lawyer_history_idx ON marketplace_acceptances(lawyer_id,accepted_at DESC,id DESC);
CREATE TABLE marketplace_reviews (
 id TEXT PRIMARY KEY NOT NULL,
 marketplace_post_id TEXT NOT NULL UNIQUE REFERENCES marketplace_posts(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 lawyer_id TEXT NOT NULL REFERENCES lawyer_profiles(id) ON DELETE RESTRICT,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT CHECK(comment IS NULL OR length(trim(comment)) BETWEEN 2 AND 500),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX marketplace_reviews_lawyer_idx ON marketplace_reviews(lawyer_id,created_at DESC);

-- One SQLite writer serializes capacity and balance checks with the usage ledger insert.
CREATE TRIGGER marketplace_accept_guard BEFORE INSERT ON marketplace_acceptances
BEGIN
 SELECT RAISE(ABORT,'post closed') WHERE NOT EXISTS(SELECT 1 FROM marketplace_posts
   WHERE id=NEW.marketplace_post_id AND status='open' AND (expires_at IS NULL OR expires_at>NEW.accepted_at));
 SELECT RAISE(ABORT,'accept capacity full') WHERE (SELECT count(*) FROM marketplace_acceptances
   WHERE marketplace_post_id=NEW.marketplace_post_id)>=(SELECT max_acceptances FROM marketplace_posts WHERE id=NEW.marketplace_post_id);
 SELECT RAISE(ABORT,'lawyer forbidden') WHERE NOT EXISTS(SELECT 1 FROM lawyer_profiles l JOIN users u ON u.id=l.user_id
   JOIN marketplace_posts p ON p.id=NEW.marketplace_post_id WHERE l.id=NEW.lawyer_id
   AND l.verification_status='approved' AND u.status='active' AND u.onboarding_role='lawyer'
   AND u.active_mode='lawyer' AND u.id<>p.user_id);
 SELECT RAISE(ABORT,'insufficient accepts') WHERE coalesce((SELECT sum(amount) FROM marketplace_accept_transactions
   WHERE lawyer_id=NEW.lawyer_id AND (expires_at IS NULL OR expires_at>NEW.accepted_at)),0)<1;
 INSERT INTO marketplace_accept_transactions(id,lawyer_id,type,amount,balance_after,expires_at,reference_id,created_at)
 SELECT NEW.ledger_transaction_id,NEW.lawyer_id,'usage',-1,
   coalesce((SELECT sum(amount) FROM marketplace_accept_transactions WHERE lawyer_id=NEW.lawyer_id
     AND (expires_at IS NULL OR expires_at>NEW.accepted_at)),0)-1,
   g.expires_at,'marketplace:'||NEW.marketplace_post_id,NEW.accepted_at
 FROM (SELECT expires_at FROM marketplace_accept_transactions WHERE lawyer_id=NEW.lawyer_id
   AND (expires_at IS NULL OR expires_at>NEW.accepted_at) GROUP BY expires_at HAVING sum(amount)>0
   ORDER BY expires_at IS NULL,expires_at LIMIT 1) g;
 SELECT RAISE(ABORT,'no available accept bucket') WHERE NOT EXISTS(SELECT 1 FROM marketplace_accept_transactions
   WHERE id=NEW.ledger_transaction_id AND lawyer_id=NEW.lawyer_id AND type='usage');
END;
CREATE TRIGGER marketplace_selected_guard BEFORE UPDATE OF status ON marketplace_posts
WHEN NEW.status='selected' AND OLD.status<>'selected'
BEGIN
 SELECT RAISE(ABORT,'selection owner mismatch') WHERE NOT EXISTS(SELECT 1 FROM marketplace_acceptances
   WHERE id=NEW.selected_acceptance_id AND marketplace_post_id=NEW.id AND status='accepted');
 SELECT RAISE(ABORT,'post not open') WHERE OLD.status<>'open';
END;
CREATE TRIGGER marketplace_selected_apply AFTER UPDATE OF status ON marketplace_posts
WHEN NEW.status='selected' AND OLD.status='open'
BEGIN
 UPDATE marketplace_acceptances SET status='not_selected',closed_at=NEW.selected_at
   WHERE marketplace_post_id=NEW.id AND id<>NEW.selected_acceptance_id AND status='accepted';
 UPDATE marketplace_acceptances SET status='selected',selected_at=NEW.selected_at
   WHERE id=NEW.selected_acceptance_id AND status='accepted';
 UPDATE lawyer_profiles SET jobs_count=jobs_count+1
   WHERE id=(SELECT lawyer_id FROM marketplace_acceptances WHERE id=NEW.selected_acceptance_id);
END;
CREATE TRIGGER marketplace_reviews_insert_guard BEFORE INSERT ON marketplace_reviews
BEGIN
 SELECT RAISE(ABORT,'review owner or selected lawyer mismatch') WHERE NOT EXISTS(
   SELECT 1 FROM marketplace_posts p JOIN marketplace_acceptances a ON a.id=p.selected_acceptance_id
   WHERE p.id=NEW.marketplace_post_id AND p.status='selected' AND p.user_id=NEW.user_id
     AND a.lawyer_id=NEW.lawyer_id AND a.status='selected');
END;
CREATE TRIGGER marketplace_reviews_rating AFTER INSERT ON marketplace_reviews
BEGIN UPDATE lawyer_profiles SET rating_count=(SELECT count(*) FROM marketplace_reviews WHERE lawyer_id=NEW.lawyer_id),
 rating_average_hundredths=(SELECT (sum(rating)*100+count(*)/2)/count(*) FROM marketplace_reviews WHERE lawyer_id=NEW.lawyer_id)
 WHERE id=NEW.lawyer_id; END;
CREATE TRIGGER marketplace_reviews_update_guard BEFORE UPDATE ON marketplace_reviews BEGIN SELECT RAISE(ABORT,'immutable review'); END;
CREATE TRIGGER marketplace_reviews_delete_guard BEFORE DELETE ON marketplace_reviews BEGIN SELECT RAISE(ABORT,'immutable review'); END;
