-- A user has at most one draft; terminal posts close outstanding acceptances atomically.
CREATE UNIQUE INDEX marketplace_one_draft_per_user ON marketplace_posts(user_id) WHERE status='draft';
CREATE TRIGGER marketplace_close_acceptances AFTER UPDATE OF status ON marketplace_posts
WHEN OLD.status='open' AND NEW.status IN ('expired','cancelled')
BEGIN UPDATE marketplace_acceptances SET status=CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'not_selected' END,
 closed_at=coalesce(NEW.cancelled_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE marketplace_post_id=NEW.id AND status='accepted'; END;
