"""Marketplace capacity, accept spending and selected-review invariants."""

import sqlite3
import unittest
from pathlib import Path

HERE = Path(__file__).parent
NOW = '2026-11-26T12:00:00.000Z'


class MarketplaceSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for path in sorted(HERE.glob('[0-9][0-9][0-9][0-9]_*.sql')):
            self.db.executescript(path.read_text())
        for id, telegram, duid, role in [
            ('owner', 42, 'yr_abcdefghijklmnop', 'user'),
            ('lawyer', 43, 'yr_abcdefghijklmnox', 'lawyer'),
            ('lawyer2', 44, 'yr_abcdefghijklmnoy', 'lawyer'),
        ]:
            self.db.execute("INSERT INTO users(id,telegram_user_id,duid,full_name,onboarding_role,active_mode,created_at) VALUES(?,?,?,?,?,?,?)",
                            (id, telegram, duid, 'Example Name', role, role, NOW))
        for user, lawyer in [('lawyer', 'l1'), ('lawyer2', 'l2')]:
            self.db.execute("INSERT INTO lawyer_profiles(id,user_id,public_slug,verification_status) VALUES(?,?,?,'approved')",
                            (lawyer, user, lawyer))
            self.db.execute("INSERT INTO marketplace_accept_transactions(id,lawyer_id,type,amount,balance_after,reference_id,created_at) VALUES(?,?,'bonus',1,1,?,?)",
                            ('grant-' + lawyer, lawyer, 'bonus-' + lawyer, NOW))
        self.db.execute("INSERT INTO marketplace_posts(id,public_id,user_id,description,status,draft_step,specialization_id,max_acceptances,idempotency_key,created_at) VALUES('p',?,'owner','A meaningful legal request description','open','complete',?,1,'request:1',?)",
                        ('mp_' + 'a' * 20, '00000000-0000-4000-8000-000000000001', NOW))

    def tearDown(self):
        self.db.close()

    def accept(self, id, lawyer, ledger):
        self.db.execute("INSERT INTO marketplace_acceptances(id,public_id,marketplace_post_id,lawyer_id,ledger_transaction_id,accepted_at) VALUES(?,?,'p',?,?,?)",
                        (id, 'ma_' + id * 20, lawyer, ledger, NOW))

    def test_acceptance_spends_once_and_capacity_rejects_without_debit(self):
        self.accept('a', 'l1', 'usage-1')
        with self.assertRaises(sqlite3.IntegrityError):
            self.accept('b', 'l2', 'usage-2')
        self.assertEqual(self.db.execute("SELECT count(*) FROM marketplace_accept_transactions WHERE type='usage'").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT sum(amount) FROM marketplace_accept_transactions WHERE lawyer_id='l2'").fetchone()[0], 1)

    def test_selection_and_review_update_lawyer(self):
        self.accept('a', 'l1', 'usage-1')
        self.db.execute("UPDATE marketplace_posts SET status='selected',selected_acceptance_id='a',selected_at=? WHERE id='p'", (NOW,))
        self.assertEqual(self.db.execute("SELECT status FROM marketplace_acceptances WHERE id='a'").fetchone()[0], 'selected')
        self.assertEqual(self.db.execute("SELECT jobs_count FROM lawyer_profiles WHERE id='l1'").fetchone()[0], 1)
        self.db.execute("INSERT INTO marketplace_reviews(id,marketplace_post_id,user_id,lawyer_id,rating) VALUES('r','p','owner','l1',5)")
        self.assertEqual(self.db.execute("SELECT rating_average_hundredths FROM lawyer_profiles WHERE id='l1'").fetchone()[0], 500)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE marketplace_reviews SET rating=1 WHERE id='r'")

    def test_non_owner_cannot_insert_review(self):
        self.accept('a', 'l1', 'usage-1')
        self.db.execute("UPDATE marketplace_posts SET status='selected',selected_acceptance_id='a',selected_at=? WHERE id='p'", (NOW,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO marketplace_reviews(id,marketplace_post_id,user_id,lawyer_id,rating) VALUES('r','p','lawyer2','l1',5)")

    def test_cancelling_closes_outstanding_acceptance(self):
        self.accept('a', 'l1', 'usage-1')
        self.db.execute("UPDATE marketplace_posts SET status='cancelled',cancelled_at=? WHERE id='p'", (NOW,))
        self.assertEqual(self.db.execute("SELECT status FROM marketplace_acceptances WHERE id='a'").fetchone()[0], 'cancelled')


if __name__ == '__main__':
    unittest.main()
