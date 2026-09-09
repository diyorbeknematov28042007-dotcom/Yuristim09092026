begin;

select plan(14);

select has_table('public', 'users', 'users table exists');
select has_table('public', 'auth_sessions', 'auth_sessions table exists');
select has_table('public', 'auth_login_requests', 'auth_login_requests table exists');
select has_table('public', 'user_tags', 'user_tags table exists');

select col_is_pk('public', 'users', 'id', 'users.id is primary key');
select col_is_unique('public', 'users', 'telegram_user_id', 'Telegram identity is unique');
select col_is_unique('public', 'users', 'duid', 'DUID is unique');
select col_is_unique('public', 'auth_sessions', 'token_hash', 'session hash is unique');
select col_is_unique(
  'public',
  'auth_login_requests',
  'challenge_hash',
  'login challenge hash is unique'
);

select has_check(
  'public',
  'users',
  'users_onboarding_status_check',
  'onboarding state values are constrained'
);
select has_check(
  'public',
  'users',
  'completed_onboarding_is_valid',
  'completed onboarding requires its persisted fields'
);

select policies_are(
  'public',
  'users',
  array['users_deny_direct_client_access'],
  'users explicitly denies client access'
);
select policies_are(
  'public',
  'auth_sessions',
  array['auth_sessions_deny_direct_client_access'],
  'auth_sessions explicitly denies client access'
);
select policies_are(
  'public',
  'user_tags',
  array['user_tags_deny_direct_client_access'],
  'user_tags explicitly denies client access'
);

select * from finish();
rollback;
