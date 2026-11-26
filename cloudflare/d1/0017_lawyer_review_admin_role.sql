-- Defense in depth: only a full admin, never a support account, may finalize
-- lawyer verification. Preserve the original 0016 claim/immutability guards.
DROP TRIGGER lawyer_review_claim_guard;
CREATE TRIGGER lawyer_review_claim_guard BEFORE UPDATE OF status ON lawyer_verifications
WHEN NEW.status IN ('approved','rejected') AND OLD.status<>NEW.status
BEGIN
 SELECT RAISE(ABORT,'invalid lawyer review transition') WHERE
   OLD.status NOT IN ('submitted','pending_review') OR NEW.review_claim_id IS NULL
   OR length(NEW.review_claim_id)<>36
   OR NOT EXISTS(SELECT 1 FROM admin_accounts
     WHERE id=NEW.reviewed_by AND role='admin' AND status='active');
END;
