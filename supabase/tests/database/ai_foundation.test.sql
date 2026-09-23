begin;

select plan(51);

select has_table('public', 'ai_conversations', 'AI conversations exist');
select has_table('public', 'ai_messages', 'AI messages exist');
select has_table('public', 'ai_message_sources', 'AI source foundation exists');
select has_table('public', 'ai_user_states', 'persistent bot AI state exists');
select col_is_unique('public', 'ai_conversations', 'public_id', 'conversation public id is unique');
select col_is_unique('public', 'ai_messages', 'public_id', 'message public id is unique');
select col_is_unique('public', 'ai_messages', 'request_message_id', 'one assistant exists per request');
select is((select relrowsecurity from pg_class where oid = 'public.ai_conversations'::regclass), true, 'conversation RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ai_conversations'::regclass), true, 'conversation RLS forced');
select is((select relrowsecurity from pg_class where oid = 'public.ai_messages'::regclass), true, 'message RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ai_messages'::regclass), true, 'message RLS forced');
select is((select relrowsecurity from pg_class where oid = 'public.ai_message_sources'::regclass), true, 'source RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.ai_user_states'::regclass), true, 'bot state RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ai_message_sources'::regclass), true, 'source RLS forced');
select is((select relforcerowsecurity from pg_class where oid = 'public.ai_user_states'::regclass), true, 'bot state RLS forced');
select policies_are('public', 'ai_conversations', array['ai_conversations_deny_direct_client_access'], 'conversation clients denied');
select policies_are('public', 'ai_messages', array['ai_messages_deny_direct_client_access'], 'message clients denied');
select policies_are('public', 'ai_message_sources', array['ai_message_sources_deny_direct_client_access'], 'source clients denied');
select policies_are('public', 'ai_user_states', array['ai_user_states_deny_direct_client_access'], 'state clients denied');
select ok(not has_function_privilege('anon', 'public.create_ai_conversation(uuid,text,text,timestamptz)', 'EXECUTE'), 'anon cannot create AI conversations');
select ok(has_function_privilege('service_role', 'public.complete_ai_message(uuid,uuid,text,integer,integer,numeric,numeric,timestamptz)', 'EXECUTE'), 'service role can atomically complete and charge');

insert into public.users (
  id, telegram_user_id, telegram_first_name, duid, language, onboarding_role, active_mode,
  onboarding_status, terms_accepted_at, terms_version, status, created_at
) values (
  '70000000-0000-4000-8000-000000000001', 907000000001, 'Phase 7',
  'yr_phase7test000001', 'uz', 'user', 'user', 'completed',
  '2026-09-17 08:00:00+00', '2026-09', 'active',
  '2026-09-17 08:00:00+00'
);

create temporary table phase7_conversation as
select * from public.create_ai_conversation(
  '70000000-0000-4000-8000-000000000001', 'fast', 'uz-law-mvp-v1',
  '2026-09-17 08:00:00+00'
);
select matches((select public_id from phase7_conversation), '^aic_[a-f0-9]{24}$', 'conversation has a public-safe id');
select is(
  (select active_conversation_id from public.ai_user_states where user_id = '70000000-0000-4000-8000-000000000001'),
  (select id from phase7_conversation), 'bot state persists the active conversation'
);

create temporary table phase7_begin(result jsonb) on commit drop;
insert into phase7_begin
select public.begin_ai_message(
  '70000000-0000-4000-8000-000000000001', (select id from phase7_conversation),
  'Mehnat shartnomasi haqida ayting', 'fast', 'phase7-request-0001',
  'gemini', 'gemini-test', 'uz-law-mvp-v1', 'Mehnat shartnomasi haqida ayting',
  false, '2026-09-17 08:01:00+00'
);
select is((select count(*)::integer from public.ai_messages), 2, 'begin persists user and assistant messages together');
select is((select title from public.ai_conversations where id = (select id from phase7_conversation)), 'Mehnat shartnomasi haqida ayting', 'first message sets deterministic title');
select is((select status from public.ai_messages where role = 'user'), 'completed', 'user message is immutable completed history');
select is((select status from public.ai_messages where role = 'assistant'), 'running', 'assistant starts in running state');

select public.complete_ai_message(
  '70000000-0000-4000-8000-000000000001',
  ((select result from phase7_begin)->'assistantMessage'->>'id')::uuid,
  'Ehtiyotkor va foydali javob', 120, 80, 0.00023600, 1.250,
  '2026-09-17 08:02:00+00'
);
select is((select status from public.ai_messages where role = 'assistant'), 'completed', 'successful assistant reaches completed');
select is((select charged_credits from public.ai_messages where role = 'assistant'), 1.250::numeric, 'fractional actual charge is stored');
select is((select sum(amount) from public.credit_transactions where source = 'ai_message'), -1.250::numeric, 'successful response appends exact debit');
select lives_ok(
  $$select public.complete_ai_message(
    '70000000-0000-4000-8000-000000000001',
    ((select result from phase7_begin)->'assistantMessage'->>'id')::uuid,
    'Ehtiyotkor va foydali javob', 120, 80, 0.00023600, 1.250,
    '2026-09-17 08:02:01+00'
  )$$,
  'completion retry is idempotent'
);
select is((select count(*)::integer from public.credit_transactions where source = 'ai_message'), 1, 'completion retry never double charges');

create temporary table phase7_duplicate(result jsonb) on commit drop;
insert into phase7_duplicate
select public.begin_ai_message(
  '70000000-0000-4000-8000-000000000001', (select id from phase7_conversation),
  'Takroriy matn e’tiborga olinmaydi', 'fast', 'phase7-request-0001',
  'gemini', 'gemini-test', 'uz-law-mvp-v1', 'Other title', false,
  '2026-09-17 08:03:00+00'
);
select is(((select result from phase7_duplicate)->>'duplicate')::boolean, true, 'duplicate submission is detected by idempotency key');
select is((select count(*)::integer from public.ai_messages), 2, 'duplicate submission creates no messages');

create temporary table phase7_failure(result jsonb) on commit drop;
insert into phase7_failure
select public.begin_ai_message(
  '70000000-0000-4000-8000-000000000001', (select id from phase7_conversation),
  'Provider ishlamasin', 'fast', 'phase7-request-0002', 'gemini', 'gemini-test',
  'uz-law-mvp-v1', 'Provider ishlamasin', true, '2026-09-17 08:04:00+00'
);
select public.fail_ai_message(
  '70000000-0000-4000-8000-000000000001',
  ((select result from phase7_failure)->'assistantMessage'->>'id')::uuid,
  'provider_timeout', false, '2026-09-17 08:05:00+00'
);
select is((select status from public.ai_messages where error_code = 'provider_timeout'), 'failed', 'provider failure is persisted');
select is((select charged_credits from public.ai_messages where error_code = 'provider_timeout'), 0.000::numeric, 'failed response has zero charge');
select is((select count(*)::integer from public.credit_transactions where reference_id = ((select result from phase7_failure)->'assistantMessage'->>'public_id')), 0, 'failed response appends no debit');

create temporary table phase7_expert(result jsonb) on commit drop;
insert into phase7_expert
select public.begin_ai_message(
  '70000000-0000-4000-8000-000000000001', (select id from phase7_conversation),
  'Oldingi savol bo‘yicha chuqurroq ayting', 'expert', 'phase7-request-0003',
  'openai', 'expert-test', 'uz-law-mvp-v1', 'Ignored title', false,
  '2026-09-17 08:06:00+00'
);
select is((select mode from public.ai_conversations where id = (select id from phase7_conversation)), 'expert', 'mode switch keeps the same conversation');
select is((select count(*)::integer from public.ai_messages), 6, 'mode switch retains prior message history');
select is((select mode from public.ai_messages where id = ((select result from phase7_expert)->'assistantMessage'->>'id')::uuid), 'expert', 'per-message routing mode is preserved');
select throws_ok(
  $$select public.begin_ai_message(
    '70000000-0000-4000-8000-000000000099', (select id from phase7_conversation),
    'Begona chat', 'fast', 'phase7-request-0099', 'gemini', 'gemini-test',
    'uz-law-mvp-v1', 'Begona chat', false, now()
  )$$,
  'P0002', 'AI conversation not found', 'cross-user conversation access is rejected'
);
select throws_ok(
  $$update public.ai_messages set status = 'running'
    where id = ((select result from phase7_begin)->'assistantMessage'->>'id')::uuid$$,
  '22023', 'invalid AI message state transition', 'invalid completed-to-running transition is rejected'
);
select is((select count(*)::integer from public.ai_message_sources), 0, 'Phase 7 creates no fabricated sources');

select public.reverse_ai_delivery_charge(
  '70000000-0000-4000-8000-000000000001',
  ((select result from phase7_begin)->'assistantMessage'->>'id')::uuid,
  '2026-09-17 08:07:00+00'
);
select is((select status from public.ai_messages where id = ((select result from phase7_begin)->'assistantMessage'->>'id')::uuid), 'failed', 'delivery failure changes completion to failed');
select is((select refunded_credits from public.ai_messages where id = ((select result from phase7_begin)->'assistantMessage'->>'id')::uuid), 1.250::numeric, 'delivery failure records exact refund');
select is((select total from public.credit_balance('70000000-0000-4000-8000-000000000001', '2026-09-17 08:07:00+00')), 50.000::numeric, 'append-only reversal restores user balance');
select is((select sum(amount) from public.credit_transactions where type = 'reversal' and source = 'ai_delivery'), 1.250::numeric, 'delivery reversal appends a positive ledger record');
select lives_ok(
  $$select public.reverse_ai_delivery_charge(
    '70000000-0000-4000-8000-000000000001',
    ((select result from phase7_begin)->'assistantMessage'->>'id')::uuid,
    '2026-09-17 08:07:01+00'
  )$$,
  'delivery reversal retry is idempotent'
);
select is((select count(*)::integer from public.credit_transactions where type = 'reversal' and source = 'ai_delivery'), 1, 'delivery retry never double refunds');
select throws_ok(
  $$insert into public.ai_message_sources (
      message_id, citation_order, title, url, source_type
    ) values (
      ((select result from phase7_expert)->'assistantMessage'->>'id')::uuid,
      1, 'Fake source', 'http://example.com', 'other'
    )$$,
  '23514', null, 'non-HTTPS source URL is rejected'
);
select is((select system_prompt_version from public.ai_conversations where id = (select id from phase7_conversation)), 'uz-law-mvp-v1', 'conversation records the prompt policy version');

select * from finish();
rollback;
