-- The ledger grant and its audit entry commit or fail as one SQL statement.
CREATE TRIGGER credit_admin_bonus_audit AFTER INSERT ON credit_transactions
WHEN NEW.type='admin_bonus'
BEGIN
 SELECT RAISE(ABORT,'admin bonus requires actor') WHERE NEW.created_by IS NULL OR NEW.source<>'admin';
 INSERT INTO audit_logs(id,actor_type,actor_id,action,entity_type,entity_id,metadata)
 VALUES(lower(hex(randomblob(16))),'admin',NEW.created_by,'credits.admin_bonus','user',NEW.user_id,
   json_object('amountMilli',NEW.amount_milli,'reason',NEW.reason,'transactionId',NEW.id));
END;
