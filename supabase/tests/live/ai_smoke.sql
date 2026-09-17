begin;

do $$
declare
  v_user_id uuid := '70000000-0000-4000-8000-000000000099';
  v_conversation public.ai_conversations%rowtype;
  v_begin jsonb;
  v_duplicate jsonb;
  v_failure jsonb;
  v_message public.ai_messages%rowtype;
  v_balance numeric;
begin
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.ai_conversations'::regclass),
    'conversation RLS must be enabled and forced';
  assert (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.ai_messages'::regclass),
    'message RLS must be enabled and forced';
  assert not has_function_privilege('anon', 'public.create_ai_conversation(uuid,text,text,timestamptz)', 'EXECUTE'),
    'anon must not execute AI functions';

  insert into public.users (
    id, telegram_user_id, telegram_first_name, duid, language, onboarding_role, active_mode,
    onboarding_status, terms_accepted_at, terms_version, status, created_at
  ) values (
    v_user_id, 907000000099, 'Phase 7 live smoke', 'yr_phase7live000099',
    'uz', 'user', 'user', 'completed', '2026-09-17 08:00:00+00', '2026-09',
    'active', '2026-09-17 08:00:00+00'
  );

  v_conversation := public.create_ai_conversation(
    v_user_id, 'fast', 'uz-law-mvp-v1', '2026-09-17 08:00:00+00'
  );
  assert v_conversation.public_id ~ '^aic_[a-f0-9]{24}$', 'public id must be safe';

  v_begin := public.begin_ai_message(
    v_user_id, v_conversation.id, 'Real database smoke prompt', 'fast',
    'phase7-live-request-0001', 'gemini', 'gemini-test', 'uz-law-mvp-v1',
    'Real database smoke prompt', false, '2026-09-17 08:01:00+00'
  );
  v_message := public.complete_ai_message(
    v_user_id, (v_begin->'assistantMessage'->>'id')::uuid,
    'Real database smoke answer', 100, 50, 0.0002, 1.250,
    '2026-09-17 08:02:00+00'
  );
  assert v_message.status = 'completed' and v_message.charged_credits = 1.250,
    'completion and fractional charge must persist atomically';

  v_message := public.complete_ai_message(
    v_user_id, (v_begin->'assistantMessage'->>'id')::uuid,
    'Real database smoke answer', 100, 50, 0.0002, 1.250,
    '2026-09-17 08:02:01+00'
  );
  assert (select count(*) from public.credit_transactions where source = 'ai_message') = 1,
    'completion retry must not double charge';

  v_duplicate := public.begin_ai_message(
    v_user_id, v_conversation.id, 'Ignored duplicate prompt', 'fast',
    'phase7-live-request-0001', 'gemini', 'gemini-test', 'uz-law-mvp-v1',
    'Ignored title', false, '2026-09-17 08:03:00+00'
  );
  assert (v_duplicate->>'duplicate')::boolean, 'request idempotency must detect duplicate';
  assert (select count(*) from public.ai_messages where conversation_id = v_conversation.id) = 2,
    'duplicate request must not create messages';

  v_failure := public.begin_ai_message(
    v_user_id, v_conversation.id, 'Failure prompt', 'fast',
    'phase7-live-request-0002', 'gemini', 'gemini-test', 'uz-law-mvp-v1',
    'Failure prompt', true, '2026-09-17 08:04:00+00'
  );
  v_message := public.fail_ai_message(
    v_user_id, (v_failure->'assistantMessage'->>'id')::uuid,
    'provider_timeout', false, '2026-09-17 08:05:00+00'
  );
  assert v_message.status = 'failed' and v_message.charged_credits = 0,
    'provider failure must persist with zero charge';

  v_message := public.reverse_ai_delivery_charge(
    v_user_id, (v_begin->'assistantMessage'->>'id')::uuid,
    '2026-09-17 08:06:00+00'
  );
  assert v_message.status = 'failed' and v_message.refunded_credits = 1.250,
    'delivery failure must append exact reversal';
  select total into v_balance from public.credit_balance(v_user_id, '2026-09-17 08:06:00+00');
  assert v_balance = 50.000, 'reversal must restore balance';
  assert (select count(*) from public.ai_message_sources) = 0,
    'Phase 7 smoke must not create fabricated sources';
end;
$$;

select jsonb_build_object(
  'status', 'pass',
  'transaction', 'rolled_back',
  'checks', array[
    'rls_force', 'client_denial', 'persistence', 'fractional_charge',
    'exactly_once', 'failed_no_charge', 'delivery_reversal', 'no_fake_sources'
  ]
) as phase7_ai_smoke;

rollback;
