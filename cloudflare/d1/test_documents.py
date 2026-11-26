"""Private document state and metadata constraints."""

import sqlite3
import unittest
from pathlib import Path

HERE = Path(__file__).parent
NOW = '2026-11-26T12:00:00.000Z'
LATER = '2026-11-26T14:00:00.000Z'


class DocumentsSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for path in sorted(HERE.glob('[0-9][0-9][0-9][0-9]_*.sql')):
            self.db.executescript(path.read_text())
        self.db.execute("INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES('u',42,'yr_abcdefghijklmnop',?)", (NOW,))
        self.db.execute("INSERT INTO admin_accounts(id,username,password_hash) VALUES('a','admin','hash')")
        self.path = 'u/00000000-0000-4000-8000-000000000001/source.pdf'

    def tearDown(self):
        self.db.close()

    def draft(self, path=None):
        self.db.execute("""INSERT INTO document_contributions
            (id,public_id,user_id,document_type,original_filename,mime_type,file_size_bytes,
             storage_path,privacy_acknowledged,rights_confirmed,idempotency_key,
             upload_fingerprint,upload_expires_at,created_at)
             VALUES('d',?,'u','talabnoma','source.pdf','application/pdf',100,?,1,1,
               '00000000-0000-4000-8000-000000000001',?,?,?)""",
            ('DLC-' + 'a'*32, path or self.path, 'a'*64, LATER, NOW))

    def test_draft_submission_review_and_final_immutability(self):
        self.draft()
        self.db.execute("UPDATE document_contributions SET status='submitted',file_sha256=?,submitted_at=? WHERE id='d'", ('b'*64, NOW))
        self.db.execute("UPDATE document_contributions SET status='under_review' WHERE id='d'")
        self.db.execute("UPDATE document_contributions SET status='approved',reviewed_by='a',reviewed_at=? WHERE id='d'", (NOW,))
        self.assertEqual(self.db.execute("SELECT count(*) FROM audit_logs WHERE entity_id='d'").fetchone()[0], 1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE document_contributions SET status='rejected',rejection_reason='wrong' WHERE id='d'")

    def test_path_and_transition_validation(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.draft('other/00000000-0000-4000-8000-000000000001/source.pdf')
        self.draft()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE document_contributions SET status='approved',file_sha256=?,submitted_at=?,reviewed_by='a',reviewed_at=? WHERE id='d'", ('b'*64, NOW, NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE document_contributions SET status='submitted',file_sha256=?,submitted_at=? WHERE id='d'", ('b'*64, LATER))


if __name__ == '__main__':
    unittest.main()
