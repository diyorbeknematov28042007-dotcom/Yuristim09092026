-- AI conversation records and provider runtime state. Prompts are private D1 records.
CREATE TABLE ai_conversations (
 id TEXT PRIMARY KEY NOT NULL,
 public_id TEXT NOT NULL UNIQUE CHECK(length(public_id)=28 AND substr(public_id,1,4)='aic_' AND substr(public_id,5) NOT GLOB '*[^a-f0-9]*'),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 title TEXT CHECK(title IS NULL OR length(trim(title)) BETWEEN 1 AND 120),
 mode TEXT NOT NULL DEFAULT 'fast' CHECK(mode IN ('fast','expert')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 system_prompt_version TEXT NOT NULL CHECK(length(system_prompt_version) BETWEEN 1 AND 40),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 last_message_at TEXT,archived_at TEXT,
 CHECK((status='active' AND archived_at IS NULL) OR (status='archived' AND archived_at IS NOT NULL))
);
CREATE INDEX ai_conversations_user_history_idx ON ai_conversations(user_id,status,last_message_at DESC,created_at DESC);
CREATE TABLE ai_messages (
 id TEXT PRIMARY KEY NOT NULL,
 public_id TEXT NOT NULL UNIQUE CHECK(length(public_id)=28 AND substr(public_id,1,4)='aim_' AND substr(public_id,5) NOT GLOB '*[^a-f0-9]*'),
 conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
 request_message_id TEXT UNIQUE REFERENCES ai_messages(id) ON DELETE RESTRICT,
 role TEXT NOT NULL CHECK(role IN ('user','assistant')),
 content TEXT NOT NULL DEFAULT '' CHECK(length(content)<=100000),
 mode TEXT NOT NULL CHECK(mode IN ('fast','expert')),
 provider TEXT CHECK(provider IS NULL OR (length(provider) BETWEEN 2 AND 40 AND substr(provider,1,1) GLOB '[a-z]' AND provider NOT GLOB '*[^a-z0-9_-]*')),
 model TEXT CHECK(model IS NULL OR length(model) BETWEEN 1 AND 120),
 status TEXT NOT NULL CHECK(status IN ('pending','running','streaming','completed','failed','cancelled')),
 source_status TEXT NOT NULL DEFAULT 'none' CHECK(source_status IN ('none','available','unverified')),
 system_prompt_version TEXT NOT NULL CHECK(length(system_prompt_version) BETWEEN 1 AND 40),
 input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens>=0),
 output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens>=0),
 provider_cost_usd_e8 INTEGER CHECK(provider_cost_usd_e8 IS NULL OR provider_cost_usd_e8>=0),
 charged_milli INTEGER NOT NULL DEFAULT 0 CHECK(charged_milli>=0),
 refunded_milli INTEGER NOT NULL DEFAULT 0 CHECK(refunded_milli>=0 AND refunded_milli<=charged_milli),
 error_code TEXT CHECK(error_code IS NULL OR (length(error_code) BETWEEN 2 AND 80 AND substr(error_code,1,1) GLOB '[a-z]' AND error_code NOT GLOB '*[^a-z0-9_]*')),
 idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 160),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 completed_at TEXT,
 CHECK((role='user' AND request_message_id IS NULL AND idempotency_key IS NOT NULL) OR
       (role='assistant' AND request_message_id IS NOT NULL AND idempotency_key IS NULL)),
 CHECK((role='user' AND provider IS NULL AND model IS NULL) OR
       (role='assistant' AND provider IS NOT NULL AND model IS NOT NULL)),
 CHECK(role<>'user' OR (status='completed' AND length(trim(content)) BETWEEN 1 AND 12000
   AND completed_at IS NOT NULL AND charged_milli=0 AND refunded_milli=0 AND error_code IS NULL)),
 CHECK(role<>'assistant' OR status NOT IN ('completed','failed','cancelled') OR completed_at IS NOT NULL),
 CHECK(role<>'assistant' OR status<>'completed' OR
   (length(trim(content))>0 AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL
    AND provider_cost_usd_e8 IS NOT NULL AND charged_milli>=1000 AND refunded_milli=0 AND error_code IS NULL)),
 CHECK(status<>'failed' OR charged_milli=refunded_milli)
);
CREATE UNIQUE INDEX ai_messages_idempotency_idx ON ai_messages(conversation_id,idempotency_key) WHERE role='user';
CREATE INDEX ai_messages_conversation_history_idx ON ai_messages(conversation_id,created_at,id);
CREATE INDEX ai_messages_active_request_idx ON ai_messages(conversation_id,status)
 WHERE role='assistant' AND status IN ('pending','running','streaming');
CREATE UNIQUE INDEX ai_messages_one_active_request ON ai_messages(conversation_id)
 WHERE role='assistant' AND status IN ('pending','running','streaming');
CREATE TABLE ai_message_sources (
 id TEXT PRIMARY KEY NOT NULL,
 message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
 citation_order INTEGER NOT NULL CHECK(citation_order BETWEEN 1 AND 100),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
 url TEXT NOT NULL CHECK(length(url) BETWEEN 8 AND 2048 AND substr(url,1,8)='https://'),
 source_type TEXT NOT NULL CHECK(source_type IN ('official_legal','official_government','court','secondary','other')),
 publisher TEXT CHECK(publisher IS NULL OR length(trim(publisher)) BETWEEN 1 AND 200),
 domain TEXT CHECK(domain IS NULL OR length(domain) BETWEEN 1 AND 253),
 is_official INTEGER NOT NULL DEFAULT 0 CHECK(is_official IN (0,1)),
 verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
 metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata) AND json_type(metadata)='object'),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(message_id,citation_order),UNIQUE(message_id,url)
);
CREATE INDEX ai_message_sources_message_idx ON ai_message_sources(message_id,citation_order);
CREATE TABLE ai_user_states (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 active_conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE SET NULL,
 preferred_mode TEXT NOT NULL DEFAULT 'fast' CHECK(preferred_mode IN ('fast','expert')),
 bot_chat_active INTEGER NOT NULL DEFAULT 0 CHECK(bot_chat_active IN (0,1)),
 telegram_control_message_id INTEGER CHECK(telegram_control_message_id IS NULL OR telegram_control_message_id>0),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ai_user_states_active_conversation_idx ON ai_user_states(active_conversation_id)
 WHERE active_conversation_id IS NOT NULL;
CREATE TRIGGER ai_user_states_owner_guard BEFORE INSERT ON ai_user_states WHEN NEW.active_conversation_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'AI conversation owner mismatch') WHERE NOT EXISTS(SELECT 1 FROM ai_conversations WHERE id=NEW.active_conversation_id AND user_id=NEW.user_id); END;
CREATE TRIGGER ai_user_states_owner_update BEFORE UPDATE OF active_conversation_id ON ai_user_states WHEN NEW.active_conversation_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'AI conversation owner mismatch') WHERE NOT EXISTS(SELECT 1 FROM ai_conversations WHERE id=NEW.active_conversation_id AND user_id=NEW.user_id); END;
CREATE TRIGGER ai_messages_request_owner BEFORE INSERT ON ai_messages WHEN NEW.role='assistant'
BEGIN SELECT RAISE(ABORT,'AI request conversation mismatch') WHERE NOT EXISTS(SELECT 1 FROM ai_messages
 WHERE id=NEW.request_message_id AND conversation_id=NEW.conversation_id AND role='user'); END;
CREATE TRIGGER ai_messages_transition BEFORE UPDATE ON ai_messages
BEGIN
 SELECT RAISE(ABORT,'immutable user AI message') WHERE OLD.role='user';
 SELECT RAISE(ABORT,'immutable AI message fields') WHERE OLD.conversation_id IS NOT NEW.conversation_id
   OR OLD.request_message_id IS NOT NEW.request_message_id OR OLD.role IS NOT NEW.role
   OR OLD.mode IS NOT NEW.mode OR OLD.system_prompt_version IS NOT NEW.system_prompt_version
   OR OLD.created_at IS NOT NEW.created_at;
 SELECT RAISE(ABORT,'AI provider route immutable') WHERE (OLD.provider IS NOT NEW.provider OR OLD.model IS NOT NEW.model)
   AND (OLD.status NOT IN ('pending','running','streaming') OR NEW.status<>OLD.status);
 SELECT RAISE(ABORT,'invalid AI transition') WHERE OLD.status<>NEW.status AND NOT (
   (OLD.status IN ('pending','running') AND NEW.status IN ('running','streaming','completed','failed','cancelled'))
   OR (OLD.status='streaming' AND NEW.status IN ('completed','failed','cancelled'))
   OR (OLD.status='completed' AND NEW.status='failed' AND NEW.error_code='delivery_failed'
       AND NEW.charged_milli=NEW.refunded_milli));
END;
CREATE TABLE ai_provider_runtime_state (
 provider TEXT PRIMARY KEY CHECK(provider IN ('gemini','bai','openai','anthropic')),
 manual_enabled INTEGER NOT NULL DEFAULT 1 CHECK(manual_enabled IN (0,1)),
 circuit_state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(circuit_state IN ('ACTIVE','OPEN','HALF_OPEN','MANUAL_PAUSED')),
 consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_failures>=0),
 failure_window_started_at TEXT,paused_until TEXT,
 cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK(cooldown_seconds BETWEEN 10 AND 86400),
 last_success_at TEXT,last_failure_at TEXT,
 last_error_category TEXT CHECK(last_error_category IS NULL OR last_error_category IN
   ('timeout','rate_limit','unavailable','invalid_request','configuration','cancelled','unknown')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(manual_enabled=1 OR circuit_state='MANUAL_PAUSED'),
 CHECK((circuit_state IN ('OPEN','HALF_OPEN') AND paused_until IS NOT NULL) OR
       (circuit_state NOT IN ('OPEN','HALF_OPEN') AND paused_until IS NULL))
);
INSERT INTO ai_provider_runtime_state(provider) VALUES('gemini'),('bai'),('openai'),('anthropic');
CREATE TABLE ai_provider_attempts (
 id TEXT PRIMARY KEY NOT NULL,
 message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('gemini','bai','openai','anthropic')),
 model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 120),
 attempt_number INTEGER NOT NULL CHECK(attempt_number>0),
 status TEXT NOT NULL CHECK(status IN ('succeeded','failed','interrupted')),
 error_category TEXT CHECK(error_category IS NULL OR error_category IN
   ('timeout','rate_limit','unavailable','invalid_request','configuration','cancelled','unknown')),
 latency_ms INTEGER NOT NULL CHECK(latency_ms>=0),
 input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens>=0),
 output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens>=0),
 started_at TEXT NOT NULL,completed_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(message_id,attempt_number),
 CHECK((status='succeeded' AND error_category IS NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL)
   OR (status IN ('failed','interrupted') AND error_category IS NOT NULL)),
 CHECK(completed_at>=started_at)
);
CREATE INDEX ai_provider_attempts_message_idx ON ai_provider_attempts(message_id,attempt_number);
CREATE INDEX ai_provider_attempts_provider_time_idx ON ai_provider_attempts(provider,started_at DESC);
