-- Review claim links all writes in a single D1.batch transaction. Once the
-- status changes, another concurrent reviewer cannot claim the same request.
ALTER TABLE lawyer_verifications ADD COLUMN review_claim_id TEXT;
CREATE UNIQUE INDEX lawyer_verification_review_claim_unique ON lawyer_verifications(review_claim_id)
 WHERE review_claim_id IS NOT NULL;
CREATE TRIGGER lawyer_review_claim_guard BEFORE UPDATE OF status ON lawyer_verifications
WHEN NEW.status IN ('approved','rejected') AND OLD.status<>NEW.status
BEGIN
 SELECT RAISE(ABORT,'invalid lawyer review transition') WHERE
   OLD.status NOT IN ('submitted','pending_review') OR NEW.review_claim_id IS NULL
   OR length(NEW.review_claim_id)<>36
   OR NOT EXISTS(SELECT 1 FROM admin_accounts WHERE id=NEW.reviewed_by AND status='active');
END;
CREATE TRIGGER lawyer_review_immutable BEFORE UPDATE ON lawyer_verifications
WHEN OLD.status IN ('approved','rejected')
BEGIN
 SELECT RAISE(ABORT,'lawyer review is immutable') WHERE
   OLD.status IS NOT NEW.status OR OLD.review_claim_id IS NOT NEW.review_claim_id
   OR OLD.reviewed_by IS NOT NEW.reviewed_by OR OLD.reviewed_at IS NOT NEW.reviewed_at
   OR OLD.reject_reason IS NOT NEW.reject_reason;
END;
