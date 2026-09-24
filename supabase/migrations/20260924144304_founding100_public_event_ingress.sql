begin;

revoke all on function public.record_founding100_public_event(text,text,text,uuid)
  from public, anon, authenticated;
drop function public.record_founding100_public_event(text,text,text,uuid);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.founding100_public_event_ingress (
  event_name text not null check (
    event_name in ('beta_page_view', 'beta_cta_click', 'telegram_opened')
  ),
  source text not null check (
    char_length(source) between 1 and 64
    and source ~ '^[a-z0-9_-]+$'
  ),
  visitor_hash text not null check (visitor_hash ~ '^[a-f0-9]{64}$'),
  occurrence_id uuid not null
);

alter table public.founding100_public_event_ingress enable row level security;
alter table public.founding100_public_event_ingress force row level security;

revoke all on table public.founding100_public_event_ingress
  from public, anon, authenticated;
grant insert (event_name, source, visitor_hash, occurrence_id)
  on table public.founding100_public_event_ingress to anon;

create policy founding100_public_event_ingress_anon_insert
  on public.founding100_public_event_ingress
  for insert
  to anon
  with check (true);

create function private.process_founding100_public_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if new.event_name not in ('beta_page_view', 'beta_cta_click', 'telegram_opened') then
    raise exception 'invalid public founding100 event' using errcode = '22023';
  end if;
  if new.source is null
     or char_length(new.source) not between 1 and 64
     or new.source !~ '^[a-z0-9_-]+$' then
    raise exception 'invalid founding100 event source' using errcode = '22023';
  end if;
  if new.visitor_hash is null or new.visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid founding100 visitor hash' using errcode = '22023';
  end if;
  if new.occurrence_id is null then
    raise exception 'invalid founding100 occurrence id' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.founding100_events
    where visitor_hash = new.visitor_hash
      and event_name in ('beta_page_view', 'beta_cta_click', 'telegram_opened')
      and created_at >= v_now - interval '1 hour'
  ) >= 240 then
    return null;
  end if;

  insert into public.founding100_events (
    event_name,
    source,
    dedupe_key,
    visitor_hash,
    created_at
  ) values (
    new.event_name,
    new.source,
    'public:' || new.event_name || ':' || new.occurrence_id::text,
    new.visitor_hash,
    v_now
  )
  on conflict (dedupe_key) do nothing;

  return null;
end;
$$;

revoke all on function private.process_founding100_public_event()
  from public, anon, authenticated;

create trigger founding100_public_event_ingress_process
  before insert on public.founding100_public_event_ingress
  for each row
  execute function private.process_founding100_public_event();

comment on table public.founding100_public_event_ingress is
  'Write-only, trigger-processed ingress for rate-limited non-sensitive Founding 100 analytics events.';
comment on function private.process_founding100_public_event() is
  'Validates and records public Founding 100 analytics without exposing the events table.';

commit;
