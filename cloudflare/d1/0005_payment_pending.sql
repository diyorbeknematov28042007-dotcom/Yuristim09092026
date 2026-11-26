-- Checkout creates a pending payment. Preserve that original API contract.
DROP TRIGGER payment_create_guard;
CREATE TRIGGER payment_create_guard BEFORE INSERT ON payments
BEGIN
 SELECT RAISE(ABORT,'invalid initial payment state') WHERE NEW.status NOT IN ('created','pending') OR NEW.provider_payment_id IS NOT NULL;
 SELECT RAISE(ABORT,'credit product snapshot mismatch') WHERE NEW.type='credits' AND NOT EXISTS(
   SELECT 1 FROM credit_products WHERE id=NEW.product_id AND code=NEW.product_code
   AND active=1 AND credit_amount_milli=NEW.product_units_milli AND price_minor=NEW.amount_money_minor);
 SELECT RAISE(ABORT,'accept product snapshot mismatch') WHERE NEW.type='marketplace_accepts' AND NOT EXISTS(
   SELECT 1 FROM marketplace_accept_products WHERE id=NEW.product_id AND code=NEW.product_code
   AND active=1 AND accept_count*1000=NEW.product_units_milli AND price_minor=NEW.amount_money_minor);
END;
