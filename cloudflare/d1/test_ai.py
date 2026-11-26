"""AI conversation ownership, request idempotency and state transition tests."""

import sqlite3
import unittest
from pathlib import Path

HERE = Path(__file__).parent
NOW = '2026-11-26T12:00:00.000Z'


class AiSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for path in sorted(HERE.glob('[0-9][0-9][0-9][0-9]_*.sql')):
            self.db.executescript(path.read_text())
        self.db.execute("INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES('u',42,'yr_abcdefghijklmnop',?)", (NOW,))
        self.db.execute("INSERT INTO users(id,telegram_user_id,duid,created_at) VALUES('other',43,'yr_abcdefghijklmnox',?)", (NOW,))
        self.db.execute("INSERT INTO ai_conversations(id,public_id,user_id,system_prompt_version) VALUES('c',?,'u','v1')", ('aic_' + 'a'*24,))
        self.db.execute("INSERT INTO ai_messages(id,public_id,conversation_id,role,content,mode,status,system_prompt_version,idempotency_key,completed_at) VALUES('q',?,'c','user','Legal question','fast','completed','v1','prompt:one',?)", ('aim_' + 'a'*24, NOW))
        self.db.execute("INSERT INTO ai_messages(id,public_id,conversation_id,request_message_id,role,mode,provider,model,status,system_prompt_version) VALUES('r',?,'c','q','assistant','fast','gemini','model','running','v1')", ('aim_' + 'b'*24,))

    def tearDown(self):
        self.db.close()

    def test_persistent_state_cannot_point_to_other_user_conversation(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO ai_user_states(user_id,active_conversation_id) VALUES('other','c')")
        self.db.execute("INSERT INTO ai_user_states(user_id,active_conversation_id,preferred_mode,bot_chat_active) VALUES('u','c','expert',1)")
        self.assertEqual(self.db.execute("SELECT preferred_mode FROM ai_user_states WHERE user_id='u'").fetchone()[0], 'expert')

    def test_one_active_request_and_prompt_idempotency(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO ai_messages(id,public_id,conversation_id,role,content,mode,status,system_prompt_version,idempotency_key,completed_at) VALUES('duplicate',?,'c','user','Again','fast','completed','v1','prompt:one',?)", ('aim_' + 'c'*24, NOW))
        self.db.execute("INSERT INTO ai_messages(id,public_id,conversation_id,role,content,mode,status,system_prompt_version,idempotency_key,completed_at) VALUES('q2',?,'c','user','New question','fast','completed','v1','prompt:two',?)", ('aim_' + 'd'*24, NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO ai_messages(id,public_id,conversation_id,request_message_id,role,mode,provider,model,status,system_prompt_version) VALUES('r2',?,'c','q2','assistant','fast','gemini','model','running','v1')", ('aim_' + 'e'*24,))

    def test_completion_usage_and_transition(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE ai_messages SET status='completed',content='Answer',completed_at=? WHERE id='r'", (NOW,))
        self.db.execute("UPDATE ai_messages SET status='completed',content='Answer',completed_at=?,input_tokens=10,output_tokens=20,provider_cost_usd_e8=100,charged_milli=1000 WHERE id='r'", (NOW,))
        self.assertEqual(self.db.execute("SELECT sum(amount_milli) FROM credit_transactions WHERE user_id='u'").fetchone()[0], 49000)
        self.assertEqual(self.db.execute("SELECT count(*) FROM credit_transactions WHERE type='ai_usage'").fetchone()[0], 1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE ai_messages SET status='streaming' WHERE id='r'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE ai_messages SET content='tampered' WHERE id='q'")
        self.db.execute("UPDATE ai_messages SET status='failed',error_code='delivery_failed',refunded_milli=1000 WHERE id='r'")
        self.assertEqual(self.db.execute("SELECT sum(amount_milli) FROM credit_transactions WHERE user_id='u'").fetchone()[0], 50000)
        self.assertEqual(self.db.execute("SELECT count(*) FROM credit_transactions WHERE type='reversal'").fetchone()[0], 1)

    def test_insufficient_credit_keeps_message_running(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE ai_messages SET status='completed',content='Answer',completed_at=?,input_tokens=10,output_tokens=20,provider_cost_usd_e8=100,charged_milli=60000 WHERE id='r'", (NOW,))
        self.assertEqual(self.db.execute("SELECT status FROM ai_messages WHERE id='r'").fetchone()[0], 'running')
        self.assertEqual(self.db.execute("SELECT sum(amount_milli) FROM credit_transactions WHERE user_id='u'").fetchone()[0], 50000)

    def test_multi_bucket_charge_and_reversal_are_atomic(self):
        self.db.execute("INSERT INTO credit_transactions(id,user_id,type,bucket_type,amount_milli,balance_after_milli,source,reference_id,expires_at,created_at) VALUES ('weekly','u','weekly_bonus','weekly',12000,62000,'weekly_cron','2026-W48','2026-11-30T19:00:00.000Z',?)", (NOW,))
        self.db.execute("UPDATE ai_messages SET status='completed',content='Answer',completed_at=?,input_tokens=10,output_tokens=20,provider_cost_usd_e8=100,charged_milli=12001 WHERE id='r'", (NOW,))
        self.assertEqual(self.db.execute("SELECT count(*) FROM credit_transactions WHERE type='ai_usage'").fetchone()[0], 2)
        self.db.execute("UPDATE ai_messages SET status='failed',error_code='delivery_failed',refunded_milli=12001 WHERE id='r'")
        self.assertEqual(self.db.execute("SELECT sum(amount_milli) FROM credit_transactions WHERE user_id='u'").fetchone()[0], 62000)

    def test_provider_states_seeded_and_validated(self):
        self.assertEqual(self.db.execute("SELECT count(*) FROM ai_provider_runtime_state").fetchone()[0], 4)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE ai_provider_runtime_state SET circuit_state='OPEN' WHERE provider='gemini'")


if __name__ == '__main__':
    unittest.main()
