-- Private R2 object metadata; Worker must verify object head/hash before submission.
CREATE TABLE document_contributions (
 id TEXT PRIMARY KEY NOT NULL,
 public_id TEXT NOT NULL UNIQUE CHECK(length(public_id)=36 AND substr(public_id,1,4)='DLC-' AND substr(public_id,5) NOT GLOB '*[^a-f0-9]*'),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 document_type TEXT NOT NULL CHECK(document_type IN ('nikoh-shartnomasi','davo-arizasi','ijara-shartnomasi','ishonchnoma','talabnoma')),
 original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 200
   AND instr(original_filename,'/')=0 AND instr(original_filename,char(92))=0
   AND instr(original_filename,char(10))=0 AND instr(original_filename,char(13))=0),
 mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 file_size_bytes INTEGER NOT NULL CHECK(file_size_bytes BETWEEN 1 AND 5242880),
 storage_path TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','under_review','approved','rejected')),
 privacy_acknowledged INTEGER NOT NULL CHECK(privacy_acknowledged=1),
 rights_confirmed INTEGER NOT NULL CHECK(rights_confirmed=1),
 idempotency_key TEXT NOT NULL,
 upload_fingerprint TEXT NOT NULL CHECK(length(upload_fingerprint)=64 AND upload_fingerprint NOT GLOB '*[^a-f0-9]*'),
 file_sha256 TEXT CHECK(file_sha256 IS NULL OR (length(file_sha256)=64 AND file_sha256 NOT GLOB '*[^a-f0-9]*')),
 upload_expires_at TEXT NOT NULL,
 submitted_at TEXT,reviewed_at TEXT,
 reviewed_by TEXT REFERENCES admin_accounts(id) ON DELETE RESTRICT,
 rejection_reason TEXT CHECK(rejection_reason IS NULL OR length(trim(rejection_reason)) BETWEEN 3 AND 1000),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(user_id,idempotency_key),
 CHECK(substr(storage_path,1,length(user_id)+1)=user_id||'/'
   AND length(storage_path) BETWEEN length(user_id)+48 AND length(user_id)+49
   AND substr(storage_path,length(user_id)+38,7)='/source'),
 CHECK((mime_type='application/pdf' AND substr(storage_path,-11)='/source.pdf' AND lower(original_filename) LIKE '%.pdf')
    OR (mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      AND substr(storage_path,-12)='/source.docx' AND lower(original_filename) LIKE '%.docx')),
 CHECK((status='draft' AND submitted_at IS NULL AND file_sha256 IS NULL)
   OR (status<>'draft' AND submitted_at IS NOT NULL AND file_sha256 IS NOT NULL)),
 CHECK((status IN ('approved','rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
   OR (status NOT IN ('approved','rejected') AND reviewed_at IS NULL AND reviewed_by IS NULL)),
 CHECK((status='rejected' AND rejection_reason IS NOT NULL) OR (status<>'rejected' AND rejection_reason IS NULL))
);
CREATE INDEX document_contributions_owner_idx ON document_contributions(user_id,submitted_at DESC,id);
CREATE INDEX document_contributions_queue_idx ON document_contributions(status,submitted_at DESC) WHERE status<>'draft';
CREATE INDEX document_contributions_hash_idx ON document_contributions(file_sha256) WHERE file_sha256 IS NOT NULL;
CREATE INDEX document_contributions_reviewer_idx ON document_contributions(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX document_contributions_expiry_idx ON document_contributions(upload_expires_at) WHERE status='draft';
CREATE TRIGGER document_contribution_update_guard BEFORE UPDATE ON document_contributions
BEGIN
 SELECT RAISE(ABORT,'review is final') WHERE OLD.status IN ('approved','rejected');
 SELECT RAISE(ABORT,'source metadata immutable') WHERE NEW.id IS NOT OLD.id OR NEW.public_id IS NOT OLD.public_id
   OR NEW.user_id IS NOT OLD.user_id OR NEW.document_type IS NOT OLD.document_type
   OR NEW.original_filename IS NOT OLD.original_filename OR NEW.mime_type IS NOT OLD.mime_type
   OR NEW.file_size_bytes IS NOT OLD.file_size_bytes OR NEW.storage_path IS NOT OLD.storage_path
   OR NEW.privacy_acknowledged IS NOT OLD.privacy_acknowledged OR NEW.rights_confirmed IS NOT OLD.rights_confirmed
   OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.upload_fingerprint IS NOT OLD.upload_fingerprint
   OR NEW.upload_expires_at IS NOT OLD.upload_expires_at OR NEW.created_at IS NOT OLD.created_at;
 SELECT RAISE(ABORT,'source hash immutable') WHERE OLD.status<>'draft'
   AND (NEW.file_sha256 IS NOT OLD.file_sha256 OR NEW.submitted_at IS NOT OLD.submitted_at);
 SELECT RAISE(ABORT,'invalid contribution transition') WHERE NEW.status<>OLD.status AND NOT (
   (OLD.status='draft' AND NEW.status='submitted') OR
   (OLD.status='submitted' AND NEW.status IN ('under_review','approved','rejected')) OR
   (OLD.status='under_review' AND NEW.status IN ('approved','rejected')));
 SELECT RAISE(ABORT,'upload expired') WHERE OLD.status='draft' AND NEW.status='submitted'
   AND OLD.upload_expires_at<=NEW.submitted_at;
 SELECT RAISE(ABORT,'admin required') WHERE NEW.status IN ('under_review','approved','rejected')
   AND NEW.status<>OLD.status AND NOT EXISTS(SELECT 1 FROM admin_accounts WHERE id=NEW.reviewed_by
     AND role='admin' AND status='active') AND NEW.status<>'under_review';
END;
CREATE TRIGGER document_contribution_review_audit AFTER UPDATE OF status ON document_contributions
WHEN NEW.status IN ('approved','rejected') AND OLD.status<>NEW.status
BEGIN INSERT INTO audit_logs(id,actor_type,actor_id,action,entity_type,entity_id,metadata)
 VALUES(lower(hex(randomblob(16))),'admin',NEW.reviewed_by,'document_contribution.'||NEW.status,
 'document_contribution',NEW.id,json_object('previousStatus',OLD.status,'status',NEW.status)); END;
