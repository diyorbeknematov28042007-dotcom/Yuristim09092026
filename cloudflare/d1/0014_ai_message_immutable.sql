-- The completion debit trigger only runs on UPDATE. Never allow a completed
-- assistant INSERT to skip it, or edits to a completed charge after settlement.
CREATE TRIGGER ai_assistant_initial_state BEFORE INSERT ON ai_messages
WHEN NEW.role='assistant' AND NEW.status NOT IN ('pending','running','streaming')
BEGIN
 SELECT RAISE(ABORT,'invalid initial assistant state');
END;
CREATE TRIGGER ai_assistant_settlement_immutable BEFORE UPDATE ON ai_messages
WHEN OLD.role='assistant'
BEGIN
 SELECT RAISE(ABORT,'AI charge fields are immutable') WHERE
   (OLD.status IN ('completed','failed','cancelled')
     AND (NEW.charged_milli IS NOT OLD.charged_milli
       OR NEW.provider_cost_usd_e8 IS NOT OLD.provider_cost_usd_e8
       OR NEW.input_tokens IS NOT OLD.input_tokens OR NEW.output_tokens IS NOT OLD.output_tokens
       OR NEW.content IS NOT OLD.content OR NEW.public_id IS NOT OLD.public_id))
   OR (OLD.status IN ('pending','running','streaming') AND
     (OLD.charged_milli<>0 OR OLD.refunded_milli<>0))
   OR (NEW.status IN ('pending','running','streaming') AND
     (NEW.charged_milli<>0 OR NEW.refunded_milli<>0))
   OR (OLD.status IN ('failed','cancelled') AND NEW.refunded_milli IS NOT OLD.refunded_milli)
   OR (OLD.status='completed' AND NEW.status<>'failed'
     AND NEW.refunded_milli IS NOT OLD.refunded_milli);
END;
