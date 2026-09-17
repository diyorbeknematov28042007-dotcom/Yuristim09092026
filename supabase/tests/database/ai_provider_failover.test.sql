begin;

select plan(20);

select has_table('public', 'ai_provider_runtime_state', 'provider runtime state exists');
select has_table('public', 'ai_provider_attempts', 'provider attempt telemetry exists');
select is((select relrowsecurity from pg_class where oid = 'public.ai_provider_runtime_state'::regclass), true, 'runtime state RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ai_provider_runtime_state'::regclass), true, 'runtime state RLS forced');
select is((select relrowsecurity from pg_class where oid = 'public.ai_provider_attempts'::regclass), true, 'attempt RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ai_provider_attempts'::regclass), true, 'attempt RLS forced');
select policies_are('public', 'ai_provider_runtime_state', array['ai_provider_runtime_state_deny_direct_client_access'], 'runtime state clients denied');
select policies_are('public', 'ai_provider_attempts', array['ai_provider_attempts_deny_direct_client_access'], 'attempt clients denied');
select ok(not has_table_privilege('anon', 'public.ai_provider_runtime_state', 'SELECT'), 'anon cannot inspect provider state');
select ok(not has_table_privilege('authenticated', 'public.ai_provider_attempts', 'SELECT'), 'authenticated users cannot inspect attempts');
select ok(not has_function_privilege('anon', 'public.acquire_ai_provider(text,integer,timestamptz)', 'EXECUTE'), 'anon cannot mutate provider state');
select ok(has_function_privilege('service_role', 'public.acquire_ai_provider(text,integer,timestamptz)', 'EXECUTE'), 'service role can acquire provider');

update public.ai_provider_runtime_state
set manual_enabled = true,
    circuit_state = 'ACTIVE',
    consecutive_failures = 0,
    failure_window_started_at = null,
    paused_until = null,
    cooldown_seconds = 300,
    last_error_category = null
where provider = 'bai';

select is(
  ((public.acquire_ai_provider('bai', 30, '2026-09-17 10:00:00+00'))->>'allowed')::boolean,
  true,
  'ACTIVE provider is acquired'
);
select is((select circuit_state from public.ai_provider_runtime_state where provider = 'bai'), 'ACTIVE', 'initial state stays ACTIVE');
select is(
  (public.record_ai_provider_failure('bai', 'timeout', 3, 120, 300, 1800, null, '2026-09-17 10:00:01+00')).circuit_state,
  'ACTIVE', 'first failure stays ACTIVE'
);
select is(
  (public.record_ai_provider_failure('bai', 'timeout', 3, 120, 300, 1800, null, '2026-09-17 10:00:02+00')).circuit_state,
  'ACTIVE', 'second failure stays ACTIVE'
);
select is(
  (public.record_ai_provider_failure('bai', 'timeout', 3, 120, 300, 1800, null, '2026-09-17 10:00:03+00')).circuit_state,
  'OPEN', 'failure threshold opens the circuit'
);
select is(
  ((public.acquire_ai_provider('bai', 30, '2026-09-17 10:00:04+00'))->>'allowed')::boolean,
  false,
  'OPEN provider is skipped'
);
select is(
  (public.acquire_ai_provider('bai', 30, '2026-09-17 10:05:04+00'))->'state'->>'circuit_state',
  'HALF_OPEN', 'cooldown expiry creates a HALF_OPEN probe'
);
select is(
  (public.record_ai_provider_success('bai', 300, '2026-09-17 10:05:05+00')).circuit_state,
  'ACTIVE', 'successful HALF_OPEN probe restores ACTIVE'
);

select * from finish();
rollback;
