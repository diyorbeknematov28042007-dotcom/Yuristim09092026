begin;

create function public.record_founding100_public_event(
  p_event_name text,
  p_source text,
  p_visitor_hash text,
  p_occurrence_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_event_name not in ('beta_page_view', 'beta_cta_click', 'telegram_opened') then
    raise exception 'invalid public founding100 event' using errcode = '22023';
  end if;
  if p_source is null
     or char_length(p_source) not between 1 and 64
     or p_source !~ '^[a-z0-9_-]+$' then
    raise exception 'invalid founding100 event source' using errcode = '22023';
  end if;
  if p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid founding100 visitor hash' using errcode = '22023';
  end if;
  if p_occurrence_id is null then
    raise exception 'invalid founding100 occurrence id' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.founding100_events
    where visitor_hash = p_visitor_hash
      and event_name in ('beta_page_view', 'beta_cta_click', 'telegram_opened')
      and created_at >= v_now - interval '1 hour'
  ) >= 240 then
    return false;
  end if;

  insert into public.founding100_events (
    event_name,
    source,
    dedupe_key,
    visitor_hash,
    created_at
  ) values (
    p_event_name,
    p_source,
    'public:' || p_event_name || ':' || p_occurrence_id::text,
    p_visitor_hash,
    v_now
  )
  on conflict (dedupe_key) do nothing;

  return true;
end;
$$;

revoke all on function public.record_founding100_public_event(text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.record_founding100_public_event(text,text,text,uuid)
  to anon;

comment on function public.record_founding100_public_event(text,text,text,uuid) is
  'Rate-limited anonymous fallback for non-sensitive Founding 100 page and Telegram funnel events.';

commit;
