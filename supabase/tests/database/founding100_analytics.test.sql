begin;

select plan(13);

select has_column(
  'public',
  'founding100_events',
  'visitor_hash',
  'campaign events store a pseudonymous visitor hash'
);
select has_index(
  'public',
  'founding100_events',
  'founding100_events_visitor_created_idx',
  'visitor analytics index exists'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.founding100_events'::regclass),
  true,
  'campaign event RLS remains enabled'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.founding100_events'::regclass),
  true,
  'campaign event RLS remains forced'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.founding100_analytics(timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot read campaign analytics'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.founding100_analytics(timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'service role can read campaign analytics'
);

select lives_ok($$
  select public.record_founding100_event(
    'beta_page_view', 'direct', null, null,
    repeat('a', 64), '2026-09-24T08:00:00Z'
  )
$$, 'first visitor page view is accepted');
select lives_ok($$
  select public.record_founding100_event(
    'beta_page_view', 'direct', null, null,
    repeat('a', 64), '2026-09-24T08:05:00Z'
  )
$$, 'repeat page view is accepted');
select lives_ok($$
  select public.record_founding100_event(
    'beta_page_view', 'telegram', null, null,
    repeat('b', 64), '2026-09-24T08:10:00Z'
  )
$$, 'second visitor page view is accepted');
select lives_ok($$
  select public.record_founding100_event(
    'beta_cta_click', 'telegram', null, null,
    repeat('b', 64), '2026-09-24T08:11:00Z'
  )
$$, 'CTA event is accepted');

select is(
  (public.founding100_analytics(
    '2026-09-24T00:00:00Z', '2026-09-25T00:00:00Z'
  )->'totals'->>'pageViews')::integer,
  3,
  'analytics counts all page views'
);
select is(
  (public.founding100_analytics(
    '2026-09-24T00:00:00Z', '2026-09-25T00:00:00Z'
  )->'totals'->>'uniqueVisitors')::integer,
  2,
  'analytics deduplicates visitors'
);
select throws_ok(
  $$select public.record_founding100_event(
    'beta_page_view', 'direct', null, null,
    'raw-browser-id', '2026-09-24T08:20:00Z'
  )$$,
  '22023',
  'invalid founding100 visitor hash',
  'raw or malformed visitor identifiers are rejected'
);

select * from finish();
rollback;
