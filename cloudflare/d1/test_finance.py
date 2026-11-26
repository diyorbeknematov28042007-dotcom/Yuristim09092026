"""Integer ledger, payment idempotency and atomic state/credit tests."""

import sqlite3
import unittest
from pathlib import Path

HERE = Path(__file__).parent
NOW = "2026-11-26T12:00:00.000Z"


class FinanceSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        for path in sorted(HERE.glob("[0-9][0-9][0-9][0-9]_*.sql")):
            self.db.executescript(path.read_text())
        self.db.execute("INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES ('u',42,'yr_abcdefghijklmnop',?)", (NOW,))
        self.db.execute("UPDATE credit_products SET price_minor=100,active=1 WHERE code='credits_100'")

    def tearDown(self):
        self.db.close()

    def balance(self):
        return self.db.execute("SELECT coalesce(sum(amount_milli),0) FROM credit_transactions WHERE user_id='u'").fetchone()[0]

    def test_welcome_granted_once_and_immutable(self):
        self.assertEqual(self.balance(), 50000)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE credit_transactions SET amount_milli=90000 WHERE user_id='u'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM credit_transactions WHERE user_id='u'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,source,reference_id,created_at) VALUES ('repeat','u','welcome_bonus','bonus',50000,100000,'onboarding','welcome:v1',?)", (NOW,))

    def test_milli_precision_and_no_overdraft(self):
        self.db.execute("INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,source,reference_id,created_at) VALUES ('fraction','u','student_bonus','bonus',1,50001,'student','fraction',?)", (NOW,))
        self.db.execute("INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,source,reference_id,created_at) VALUES ('debit','u','ai_usage','bonus',-50001,0,'ai','one',?)", (NOW,))
        self.assertEqual(self.balance(), 0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,source,reference_id,created_at) VALUES ('over','u','ai_usage','bonus',-1,0,'ai','two',?)", (NOW,))

    def test_paid_webhook_grants_once_and_rejects_conflicting_ref(self):
        self.db.execute("INSERT INTO payments(id,user_id,provider,type,amount_money_minor,product_id,product_code,product_units_milli,idempotency_key,created_at) VALUES ('p','u','sandbox','credits',100,'credits_100','credits_100',100000,'idempotency1',?)", (NOW,))
        self.db.execute("UPDATE payments SET status='paid',provider_payment_id='ref',paid_at=? WHERE id='p'", (NOW,))
        self.assertEqual(self.balance(), 150000)
        self.db.execute("UPDATE payments SET status='paid',provider_payment_id='ref' WHERE id='p'")
        self.assertEqual(self.balance(), 150000)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE payments SET provider_payment_id='another' WHERE id='p'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE payments SET status='failed',paid_at=NULL,failed_at=? WHERE id='p'", (NOW,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO payments(id,user_id,provider,type,amount_money_minor,product_id,product_code,product_units_milli,idempotency_key) VALUES ('p2','u','sandbox','credits',100,'credits_100','credits_100',100000,'idempotency1')")
        self.assertEqual(self.db.execute("SELECT count(*) FROM audit_logs WHERE entity_id='p'").fetchone()[0], 1)

    def test_payment_rolls_back_if_grant_fails(self):
        self.db.execute("INSERT INTO payments(id,user_id,provider,type,amount_money_minor,product_id,product_code,product_units_milli,idempotency_key,created_at) VALUES ('p','u','sandbox','credits',100,'credits_100','credits_100',100000,'idempotency2',?)", (NOW,))
        self.db.execute("INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,source,reference_id,created_at) VALUES ('existing','u','purchase','paid',100000,150000,'sandbox','p',?)", (NOW,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE payments SET status='paid',provider_payment_id='ref',paid_at=? WHERE id='p'", (NOW,))
        self.assertEqual(self.db.execute("SELECT status FROM payments WHERE id='p'").fetchone()[0], 'created')

    def test_payment_rejects_tampered_price_and_units(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO payments(id,user_id,provider,type,amount_money_minor,product_id,product_code,product_units_milli,idempotency_key) VALUES ('p','u','sandbox','credits',1,'credits_100','credits_100',100000,'idempotency3')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO payments(id,user_id,provider,type,amount_money_minor,product_id,product_code,product_units_milli,idempotency_key) VALUES ('p','u','sandbox','credits',100,'credits_100','credits_100',1000000,'idempotency4')")


if __name__ == '__main__':
    unittest.main()
