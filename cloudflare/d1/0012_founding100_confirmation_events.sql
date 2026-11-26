-- Confirmation and its two funnel events are a single SQLite statement.
CREATE TRIGGER founding100_confirm_events AFTER UPDATE OF status ON founding100_reservations
WHEN NEW.status='confirmed' AND OLD.status='reserved'
BEGIN
 INSERT INTO founding100_events(event_name,reservation_id,source,dedupe_key,created_at)
 VALUES('telegram_start',NEW.id,NEW.source,'telegram_start:'||NEW.id,NEW.confirmed_at)
 ON CONFLICT(dedupe_key) DO NOTHING;
 INSERT INTO founding100_events(event_name,reservation_id,source,dedupe_key,created_at)
 VALUES('beta_confirmed',NEW.id,NEW.source,'beta_confirmed:'||NEW.id,NEW.confirmed_at)
 ON CONFLICT(dedupe_key) DO NOTHING;
END;
