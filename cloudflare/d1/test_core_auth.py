"""SQLite invariant checks for the first isolated D1 migration."""

import sqlite3
import unittest
from pathlib import Path


SCHEMA = Path(__file__).with_name("0001_core_auth.sql").read_text()


class CoreAuthSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA)
        self.db.execute(
            "INSERT INTO users(id,telegram_user_id,duid) VALUES(?,?,?)",
            ("user-1", 42, "yr_abcdefghijklmnop"),
        )

    def tearDown(self):
        self.db.close()

    def test_telegram_identity_is_unique(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO users(id,telegram_user_id,duid) VALUES(?,?,?)",
                ("user-2", 42, "yr_abcdefghijklmnox"),
            )

    def test_session_requires_existing_user_and_hash(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)",
                ("session-1", "unknown", "a" * 64, "2099-01-01T00:00:00Z"),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)",
                ("session-2", "user-1", "not-a-hash", "2099-01-01T00:00:00Z"),
            )

    def test_login_challenge_cannot_be_consumed_without_confirmation(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO auth_login_requests(id,challenge_hash,status,expires_at) VALUES(?,?,?,?)",
                ("login-1", "b" * 64, "consumed", "2099-01-01T00:00:00Z"),
            )

    def test_lawyer_name_and_terms_pair_are_required(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE users SET onboarding_role='lawyer' WHERE id='user-1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE users SET terms_version='v1' WHERE id='user-1'")

    def test_tag_metadata_is_json_object(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO user_tags(id,user_id,tag,metadata) VALUES(?,?,?,?)",
                ("tag-1", "user-1", "student", "[]"),
            )


if __name__ == "__main__":
    unittest.main()
