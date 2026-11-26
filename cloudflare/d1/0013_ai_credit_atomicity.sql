-- A completed AI response and its credit debit must commit in the same SQLite statement.
CREATE TRIGGER ai_message_charge_guard BEFORE UPDATE OF status ON ai_messages
WHEN NEW.role='assistant' AND NEW.status='completed' AND OLD.status<>'completed'
BEGIN
 SELECT RAISE(ABORT,'insufficient credits') WHERE
   coalesce((SELECT sum(t.amount_milli) FROM credit_transactions t
     JOIN ai_conversations c ON c.user_id=t.user_id WHERE c.id=NEW.conversation_id
       AND (t.expires_at IS NULL OR t.expires_at>NEW.completed_at)),0)<NEW.charged_milli;
END;
CREATE TRIGGER ai_message_charge_apply AFTER UPDATE OF status ON ai_messages
WHEN NEW.role='assistant' AND NEW.status='completed' AND OLD.status<>'completed'
BEGIN
 INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,
   source,reference_id,expires_at,reason,created_at)
 WITH groups AS (
   SELECT t.bucket_type,t.expires_at,sum(t.amount_milli) available,
     CASE WHEN t.bucket_type='weekly' THEN 1
       WHEN t.bucket_type='bonus' AND t.expires_at IS NOT NULL THEN 2
       WHEN t.bucket_type='bonus' THEN 3 ELSE 4 END priority
   FROM credit_transactions t JOIN ai_conversations c ON c.user_id=t.user_id
   WHERE c.id=NEW.conversation_id AND (t.expires_at IS NULL OR t.expires_at>NEW.completed_at)
   GROUP BY t.bucket_type,t.expires_at HAVING sum(t.amount_milli)>0),
 ordered AS (SELECT bucket_type,expires_at,available,
   coalesce(sum(available) OVER (ORDER BY priority,expires_at,bucket_type
     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) before_amount FROM groups),
 total AS (SELECT c.user_id,coalesce(sum(t.amount_milli),0) balance
   FROM ai_conversations c LEFT JOIN credit_transactions t ON t.user_id=c.user_id
     AND (t.expires_at IS NULL OR t.expires_at>NEW.completed_at)
   WHERE c.id=NEW.conversation_id GROUP BY c.user_id)
 SELECT lower(hex(randomblob(16))),total.user_id,'ai_usage',ordered.bucket_type,
   -min(ordered.available,NEW.charged_milli-ordered.before_amount),
   total.balance-min(NEW.charged_milli,ordered.before_amount+ordered.available),
   'ai_message',NEW.public_id,ordered.expires_at,'Yuristim AI usage',NEW.completed_at
 FROM ordered CROSS JOIN total WHERE ordered.before_amount<NEW.charged_milli
 ORDER BY ordered.before_amount;
END;
-- A failed delivery reverses the original allocation; immutable debits remain in history.
CREATE TRIGGER ai_message_delivery_reversal AFTER UPDATE OF status ON ai_messages
WHEN OLD.status='completed' AND NEW.status='failed' AND NEW.error_code='delivery_failed'
BEGIN
 SELECT RAISE(ABORT,'AI reversal amount mismatch') WHERE
   coalesce((SELECT -sum(amount_milli) FROM credit_transactions WHERE type='ai_usage'
     AND source='ai_message' AND reference_id=NEW.public_id AND amount_milli<0),0)<>NEW.refunded_milli;
 INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,
   source,reference_id,expires_at,reason,created_at)
 WITH groups AS (
   SELECT c.user_id,t.bucket_type,t.expires_at,-sum(t.amount_milli) amount
   FROM credit_transactions t JOIN ai_conversations c ON c.user_id=t.user_id
   WHERE c.id=NEW.conversation_id AND t.type='ai_usage' AND t.source='ai_message'
     AND t.reference_id=NEW.public_id AND t.amount_milli<0
   GROUP BY c.user_id,t.bucket_type,t.expires_at),
 ordered AS (SELECT *,sum(amount) OVER (ORDER BY bucket_type,expires_at
   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) cumulative FROM groups),
 total AS (SELECT c.user_id,coalesce(sum(t.amount_milli),0) balance
   FROM ai_conversations c LEFT JOIN credit_transactions t ON t.user_id=c.user_id
     AND (t.expires_at IS NULL OR t.expires_at>NEW.completed_at)
   WHERE c.id=NEW.conversation_id GROUP BY c.user_id)
 SELECT lower(hex(randomblob(16))),ordered.user_id,'reversal',ordered.bucket_type,ordered.amount,
   total.balance+ordered.cumulative,'ai_delivery',NEW.public_id,ordered.expires_at,
   'AI response delivery failed',NEW.completed_at
 FROM ordered JOIN total ON total.user_id=ordered.user_id ORDER BY ordered.bucket_type,ordered.expires_at;
END;
