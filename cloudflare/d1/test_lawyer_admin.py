"""D1 parity checks for lawyer verification and admin audit constraints."""

import sqlite3
import unittest
from pathlib import Path

HERE = Path(__file__).parent


class LawyerAdminSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        for name in ("0001_core_auth.sql", "0002_identifier_guards.sql", "0003_lawyer_admin.sql"):
            self.db.executescript((HERE / name).read_text())
        self.db.execute("INSERT INTO users(id,telegram_user_id,duid) VALUES ('u',42,'yr_abcdefghijklmnop')")
        self.db.execute("INSERT INTO lawyer_profiles(id,user_id,public_slug) VALUES ('l','u','lawyer')")
        self.db.execute("INSERT INTO admin_accounts(id,username,password_hash) VALUES ('a','admin','hash')")

    def tearDown(self):
        self.db.close()

    def test_seed_and_one_open_request(self):
        self.assertEqual(self.db.execute("SELECT count(*) FROM specializations").fetchone()[0], 12)
        self.db.execute("INSERT INTO lawyer_verifications(id,lawyer_id,type) VALUES ('v','l','initial')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO lawyer_verifications(id,lawyer_id,type) VALUES ('v2','l','initial')")

    def test_status_tracks_initial_submission_and_cancel(self):
        self.db.execute("INSERT INTO lawyer_verifications(id,lawyer_id,type) VALUES ('v','l','initial')")
        self.assertEqual(self.db.execute("SELECT verification_status FROM lawyer_profiles").fetchone()[0], "draft")
        self.db.execute("UPDATE lawyer_verifications SET status='submitted' WHERE id='v'")
        self.assertEqual(self.db.execute("SELECT verification_status FROM lawyer_profiles").fetchone()[0], "pending_review")
        self.db.execute("UPDATE lawyer_verifications SET status='rejected',reviewed_by='a',reviewed_at='2026-11-26T00:00:00Z',reject_reason='missing' WHERE id='v'")
        self.db.execute("UPDATE lawyer_profiles SET verification_status='rejected' WHERE id='l'")
        self.db.execute("INSERT INTO lawyer_verifications(id,lawyer_id,type) VALUES ('v2','l','initial')")
        self.db.execute("DELETE FROM lawyer_verifications WHERE id='v2'")
        self.assertEqual(self.db.execute("SELECT verification_status FROM lawyer_profiles").fetchone()[0], "rejected")

    def test_submitted_snapshot_and_review_are_guarded(self):
        self.db.execute("INSERT INTO lawyer_verifications(id,lawyer_id,type,status,submitted_at) VALUES ('v','l','initial','submitted','2026-11-26T00:00:00Z')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE lawyer_verifications SET submitted_data='{} ',type='profile_update' WHERE id='v'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE lawyer_verifications SET status='approved' WHERE id='v'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE lawyer_verifications SET status='rejected',reviewed_by='a',reviewed_at='2026-11-26T01:00:00Z' WHERE id='v'")

    def test_documents_are_private_bucket_metadata(self):
        self.db.execute("INSERT INTO lawyer_verifications(id,lawyer_id,type) VALUES ('v','l','initial')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO verification_documents(id,verification_id,kind,storage_bucket,storage_path,original_filename,mime_type,size_bytes) VALUES ('d','v','profile_image','lawyer-verification','p','a.png','image/png',42)")

    def test_audit_is_immutable(self):
        self.db.execute("INSERT INTO audit_logs(id,actor_type,action,entity_type) VALUES ('audit','admin','review','lawyer')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE audit_logs SET action='other' WHERE id='audit'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM audit_logs WHERE id='audit'")


if __name__ == '__main__':
    unittest.main()
