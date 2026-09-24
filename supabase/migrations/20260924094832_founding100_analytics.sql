begin;

alter table public.founding100_events
  add column visitor_hash text;

alter table public.founding100_events
  add constraint founding100_events_visitor_hash_format check (
    visitor_hash is null or visitor_hash ~ '^[a-f0-9]{64}$'
  );

create index founding100_events_visitor_created_idx
  on public.founding100_events (visitor_hash, created_at desc)
  where visitor_hash is not null;

drop function public.record_founding100_event(text,text,uuid,text,timestamptz);

create function public.record_founding100_event(
  p_event_name text,
  p_source text,
  p_reservation_id uuid default null,
  p_dedupe_key text default null,
  p_visitor_hash text default null,
  p_now timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_event_name not in (
    'beta_page_view',
    'beta_cta_click',
    'beta_slot_reserved',
    'telegram_opened',
    'telegram_start',
    'beta_confirmed',
    'onboarding_complete'
  ) then
    raise exception 'invalid founding100 event' using errcode = '22023';
  end if;
  if p_source is null
     or char_length(p_source) not between 1 and 64
     or p_source !~ '^[a-z0-9_-]+$' then
    raise exception 'invalid founding100 event source' using errcode = '22023';
  end if;
  if p_dedupe_key is not null and char_length(p_dedupe_key) not between 8 and 160 then
    raise exception 'invalid founding100 event dedupe key' using errcode = '22023';
  end if;
  if p_visitor_hash is not null and p_visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid founding100 visitor hash' using errcode = '22023';
  end if;
  if p_reservation_id is not null
     and not exists (
       select 1 from public.founding100_reservations where id = p_reservation_id
     ) then
    raise exception 'founding100 reservation not found' using errcode = 'P0002';
  end if;

  insert into public.founding100_events (
    event_name, reservation_id, source, dedupe_key, visitor_hash, created_at
  ) values (
    p_event_name, p_reservation_id, p_source, p_dedupe_key, p_visitor_hash, p_now
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

create function public.founding100_analytics(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'invalid founding100 analytics range' using errcode = '22023';
  end if;
  if p_to - p_from > interval '366 days' then
    raise exception 'founding100 analytics range is too large' using errcode = '22023';
  end if;

  with scoped_events as (
    select event_name, source, visitor_hash, created_at
    from public.founding100_events
    where created_at >= p_from and created_at < p_to
  ),
  scoped_reservations as (
    select source, created_at, confirmed_at
    from public.founding100_reservations
    where created_at < p_to
      and (created_at >= p_from or confirmed_at >= p_from)
  ),
  totals as (
    select
      (select count(*)::integer from scoped_events where event_name = 'beta_page_view') as page_views,
      (select count(distinct visitor_hash)::integer from scoped_events where event_name = 'beta_page_view' and visitor_hash is not null) as unique_visitors,
      (select count(*)::integer from scoped_events where event_name = 'beta_cta_click') as cta_clicks,
      (select count(*)::integer from scoped_reservations where created_at >= p_from and created_at < p_to) as reservations,
      (select count(*)::integer from scoped_events where event_name = 'telegram_opened') as telegram_opened,
      (select count(*)::integer from scoped_reservations where confirmed_at >= p_from and confirmed_at < p_to) as confirmed,
      (select count(*)::integer from scoped_events where event_name = 'onboarding_complete') as onboarding_completed
  ),
  source_names as (
    select source from scoped_events
    union
    select source from scoped_reservations
  ),
  source_rows as (
    select
      names.source,
      (select count(*)::integer from scoped_events events where events.source = names.source and events.event_name = 'beta_page_view') as page_views,
      (select count(distinct events.visitor_hash)::integer from scoped_events events where events.source = names.source and events.event_name = 'beta_page_view' and events.visitor_hash is not null) as unique_visitors,
      (select count(*)::integer from scoped_reservations reservations where reservations.source = names.source and reservations.created_at >= p_from and reservations.created_at < p_to) as reservations,
      (select count(*)::integer from scoped_reservations reservations where reservations.source = names.source and reservations.confirmed_at >= p_from and reservations.confirmed_at < p_to) as confirmed
    from source_names names
  ),
  days as (
    select generate_series(
      date_trunc('day', p_from),
      date_trunc('day', p_to - interval '1 microsecond'),
      interval '1 day'
    ) as day_start
  ),
  daily_rows as (
    select
      days.day_start,
      (select count(*)::integer from scoped_events events where events.event_name = 'beta_page_view' and events.created_at >= days.day_start and events.created_at < days.day_start + interval '1 day') as page_views,
      (select count(distinct events.visitor_hash)::integer from scoped_events events where events.event_name = 'beta_page_view' and events.visitor_hash is not null and events.created_at >= days.day_start and events.created_at < days.day_start + interval '1 day') as unique_visitors,
      (select count(*)::integer from scoped_reservations reservations where reservations.created_at >= days.day_start and reservations.created_at < days.day_start + interval '1 day') as reservations,
      (select count(*)::integer from scoped_reservations reservations where reservations.confirmed_at >= days.day_start and reservations.confirmed_at < days.day_start + interval '1 day') as confirmed
    from days
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', jsonb_build_object(
      'pageViews', totals.page_views,
      'uniqueVisitors', totals.unique_visitors,
      'ctaClicks', totals.cta_clicks,
      'reservations', totals.reservations,
      'telegramOpened', totals.telegram_opened,
      'confirmed', totals.confirmed,
      'onboardingCompleted', totals.onboarding_completed
    ),
    'sources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'source', rows.source,
          'pageViews', rows.page_views,
          'uniqueVisitors', rows.unique_visitors,
          'reservations', rows.reservations,
          'confirmed', rows.confirmed
        ) order by rows.page_views desc, rows.source
      )
      from source_rows rows
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', to_char(rows.day_start at time zone 'UTC', 'YYYY-MM-DD'),
          'pageViews', rows.page_views,
          'uniqueVisitors', rows.unique_visitors,
          'reservations', rows.reservations,
          'confirmed', rows.confirmed
        ) order by rows.day_start
      )
      from daily_rows rows
    ), '[]'::jsonb)
  ) into v_result
  from totals;

  return v_result;
end;
$$;

revoke all on function public.record_founding100_event(text,text,uuid,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_founding100_event(text,text,uuid,text,text,timestamptz)
  to service_role;

revoke all on function public.founding100_analytics(timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.founding100_analytics(timestamptz,timestamptz)
  to service_role;

comment on column public.founding100_events.visitor_hash is
  'HMAC-SHA-256 pseudonymous first-party visitor identifier; no raw browser identifier or IP is stored.';
comment on function public.founding100_analytics(timestamptz,timestamptz) is
  'Server-only Founding 100 funnel analytics for a bounded UTC range.';

commit;

