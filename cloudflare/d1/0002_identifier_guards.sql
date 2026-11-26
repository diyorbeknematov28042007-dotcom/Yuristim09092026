-- Add the original PostgreSQL regex guards to databases created with 0001 v1.
-- A fresh database uses the CHECK constraints in the updated 0001 file.
CREATE TRIGGER IF NOT EXISTS users_duid_insert_guard BEFORE INSERT ON users
WHEN length(NEW.duid) <> 19 OR substr(NEW.duid, 1, 3) <> 'yr_'
  OR substr(NEW.duid, 4) GLOB '*[^A-Za-z0-9_-]*'
BEGIN
  SELECT RAISE(ABORT, 'invalid duid');
END;
CREATE TRIGGER IF NOT EXISTS users_duid_update_guard BEFORE UPDATE OF duid ON users
WHEN length(NEW.duid) <> 19 OR substr(NEW.duid, 1, 3) <> 'yr_'
  OR substr(NEW.duid, 4) GLOB '*[^A-Za-z0-9_-]*'
BEGIN
  SELECT RAISE(ABORT, 'invalid duid');
END;
CREATE TRIGGER IF NOT EXISTS user_tags_insert_guard BEFORE INSERT ON user_tags
WHEN length(NEW.tag) NOT BETWEEN 2 AND 64 OR substr(NEW.tag, 1, 1) NOT GLOB '[a-z]'
  OR NEW.tag GLOB '*[^a-z0-9:_-]*'
BEGIN
  SELECT RAISE(ABORT, 'invalid tag');
END;
CREATE TRIGGER IF NOT EXISTS user_tags_update_guard BEFORE UPDATE OF tag ON user_tags
WHEN length(NEW.tag) NOT BETWEEN 2 AND 64 OR substr(NEW.tag, 1, 1) NOT GLOB '[a-z]'
  OR NEW.tag GLOB '*[^a-z0-9:_-]*'
BEGIN
  SELECT RAISE(ABORT, 'invalid tag');
END;
