"""Founding 100 capacity, claim replay and public event ingestion."""

import sqlite3
import unittest
from pathlib import Path

HERE = Path(__file__).parent
NOW = '2026-11-26T12:00:00.000Z'


class Founding100SchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for path in sorted(HERE.glob('[0-9][0-9][0-9][0-9]_*.sql')):
            self.db.executescript(path.read_text())
        self.db.execute("INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES('u',42,'yr_abcdefghijklmnop',?)", (NOW,))

    def tearDown(self):
        self.db.close()

    def reserve(self, i):
        self.db.execute("INSERT INTO founding100_reservations(id,token_hash,idempotency_key,created_at,expires_at) VALUES(?,?,?,?,?)",
                        (str(i), f'{i:064x}', f'reserve:{i:03}', NOW, '2026-11-26T12:10:00.000Z'))

    def test_capacity_100_is_enforced_at_insert(self):
        for i in range(100):
            self.reserve(i)
        with self.assertRaises(sqlite3.IntegrityError):
            self.reserve(100)
        self.assertEqual(self.db.execute('SELECT count(*) FROM founding100_reservations').fetchone()[0], 100)

    def test_claim_one_user_and_reject_duplicate(self):
        self.reserve(1)
        self.reserve(2)
        self.db.execute("UPDATE founding100_reservations SET status='confirmed',user_id='u',confirmed_at=? WHERE id='1'", (NOW,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE founding100_reservations SET status='confirmed',user_id='u',confirmed_at=? WHERE id='2'", (NOW,))
        events = self.db.execute("SELECT event_name FROM founding100_events WHERE reservation_id='1' ORDER BY event_name").fetchall()
        self.assertEqual(events, [('beta_confirmed',), ('telegram_start',)])
        self.assertEqual(self.db.execute("SELECT count(*) FROM founding100_events WHERE reservation_id='2'").fetchone()[0], 0)

    def test_public_ingress_only_persists_deduplicated_events(self):
        args=('beta_page_view', 'direct', 'a'*64, '00000000-0000-4000-8000-000000000001')
        self.db.execute('INSERT INTO founding100_public_event_ingress VALUES(?,?,?,?)', args)
        self.db.execute('INSERT INTO founding100_public_event_ingress VALUES(?,?,?,?)', args)
        self.assertEqual(self.db.execute('SELECT count(*) FROM founding100_public_event_ingress').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM founding100_events').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
