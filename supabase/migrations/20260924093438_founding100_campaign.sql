begin;

create table public.founding100_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 128),
  source text not null default 'direct' check (
    char_length(source) between 1 and 64
    and source ~ '^[a-z0-9_-]+$'
  ),
  status text not null default 'reserved' check (
    status in ('reserved', 'confirmed', 'expired', 'released')
  ),
  user_id uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  released_at timestamptz,
  constraint founding100_reservation_state check (
    (status = 'reserved' and user_id is null and confirmed_at is null and released_at is null)
    or (status = 'confirmed' and user_id is not null and confirmed_at is not null and released_at is null)
    or (status = 'expired' and user_id is null and confirmed_at is null)
    or (status = 'released' and confirmed_at is null and released_at is not null)
  ),
  constraint founding100_expiry_after_create check (expires_at > created_at)
);

create unique index founding100_one_confirmed_per_user_idx
  on public.founding100_reservations (user_id)
  where status = 'confirmed';

create index founding100_active_reservations_idx
  on public.founding100_reservations (expires_at)
  where status = 'reserved';

create index founding100_status_idx
  on public.founding100_reservations (status, created_at);

create table public.founding100_events (
  id bigint generated always as identity primary key,
  event_name text not null check (
    event_name in (
      'beta_page_view',
      'beta_cta_click',
      'beta_slot_reserved',
      'telegram_opened',
      'telegram_start',
      'beta_confirmed',
      'onboarding_complete'
    )
  ),
  reservation_id uuid references public.founding100_reservations(id) on delete set null,
  source text not null default 'direct' check (
    char_length(source) between 1 and 64
    and source ~ '^[a-z0-9_-]+$'
  ),
  dedupe_key text unique check (
    dedupe_key is null or char_length(dedupe_key) between 8 and 160
  ),
  created_at timestamptz not null default now()
);

create index founding100_events_name_created_idx
  on public.founding100_events (event_name, created_at desc);

create index founding100_events_reservation_idx
  on public.founding100_events (reservation_id, created_at)
  where reservation_id is not null;

create function public.founding100_status(p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_limit constant integer := 100;
  v_confirmed integer;
  v_reserved integer;
  v_available integer;
begin
  update public.founding100_reservations
  set status = 'expired'
  where status = 'reserved'
    and expires_at <= p_now;

  select count(*)::integer into v_confirmed
  from public.founding100_reservations
  where status = 'confirmed';

  select count(*)::integer into v_reserved
  from public.founding100_reservations
  where status = 'reserved'
    and expires_at > p_now;

  v_available := greatest(v_limit - v_confirmed - v_reserved, 0);

  return jsonb_build_object(
    'limit', v_limit,
    'confirmed', v_confirmed,
    'reserved', v_reserved,
    'available', v_available,
    'isOpen', v_available > 0
  );
end;
$$;

create function public.reserve_founding100_slot(
  p_token_hash text,
  p_idempotency_key text,
  p_source text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_limit constant integer := 100;
  v_occupied integer;
  v_existing public.founding100_reservations%rowtype;
  v_reservation public.founding100_reservations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid founding100 token hash' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'invalid founding100 idempotency key' using errcode = '22023';
  end if;
  if p_source is null
     or char_length(p_source) not between 1 and 64
     or p_source !~ '^[a-z0-9_-]+$' then
    raise exception 'invalid founding100 source' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founding100:capacity', 0));

  update public.founding100_reservations
  set status = 'expired'
  where status = 'reserved'
    and expires_at <= p_now;

  select * into v_existing
  from public.founding100_reservations
  where idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.status = 'reserved' and v_existing.expires_at > p_now then
      return jsonb_build_object(
        'id', v_existing.id,
        'expiresAt', v_existing.expires_at,
        'status', v_existing.status,
        'source', v_existing.source,
        'duplicate', true
      );
    end if;
    raise exception 'founding100 idempotency key is no longer active' using errcode = 'P0004';
  end if;

  select count(*)::integer into v_occupied
  from public.founding100_reservations
  where status = 'confirmed'
     or (status = 'reserved' and expires_at > p_now);

  if v_occupied >= v_limit then
    raise exception 'founding100 capacity reached' using errcode = 'P0001';
  end if;

  insert into public.founding100_reservations (
    token_hash,
    idempotency_key,
    source,
    status,
    created_at,
    expires_at
  ) values (
    p_token_hash,
    p_idempotency_key,
    p_source,
    'reserved',
    p_now,
    p_now + interval '10 minutes'
  )
  returning * into v_reservation;

  return jsonb_build_object(
    'id', v_reservation.id,
    'expiresAt', v_reservation.expires_at,
    'status', v_reservation.status,
    'source', v_reservation.source,
    'duplicate', false
  );
end;
$$;

create function public.confirm_founding100_reservation(
  p_token_hash text,
  p_user_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_reservation public.founding100_reservations%rowtype;
  v_existing public.founding100_reservations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_user_id is null then
    raise exception 'invalid founding100 confirmation input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founding100:capacity', 0));

  update public.founding100_reservations
  set status = 'expired'
  where status = 'reserved'
    and expires_at <= p_now;

  select * into v_reservation
  from public.founding100_reservations
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'founding100 reservation not found' using errcode = 'P0002';
  end if;

  if v_reservation.status = 'confirmed' then
    if v_reservation.user_id = p_user_id then
      insert into public.founding100_events (
        event_name, reservation_id, source, dedupe_key, created_at
      ) values (
        'telegram_start',
        v_reservation.id,
        v_reservation.source,
        'telegram_start:' || v_reservation.id::text,
        p_now
      ) on conflict (dedupe_key) do nothing;

      return jsonb_build_object(
        'reservationId', v_reservation.id,
        'duplicate', true
      );
    end if;
    raise exception 'founding100 reservation is unavailable' using errcode = 'P0003';
  end if;

  if v_reservation.status <> 'reserved' or v_reservation.expires_at <= p_now then
    raise exception 'founding100 reservation expired' using errcode = 'P0003';
  end if;

  select * into v_existing
  from public.founding100_reservations
  where user_id = p_user_id
    and status = 'confirmed'
  limit 1
  for update;

  if found then
    update public.founding100_reservations
    set status = 'released',
        released_at = p_now
    where id = v_reservation.id;

    insert into public.founding100_events (
      event_name, reservation_id, source, dedupe_key, created_at
    ) values (
      'telegram_start',
      v_reservation.id,
      v_reservation.source,
      'telegram_start:' || v_reservation.id::text,
      p_now
    ) on conflict (dedupe_key) do nothing;

    return jsonb_build_object(
      'reservationId', v_existing.id,
      'duplicate', true
    );
  end if;

  update public.founding100_reservations
  set status = 'confirmed',
      user_id = p_user_id,
      confirmed_at = p_now
  where id = v_reservation.id
  returning * into v_reservation;

  insert into public.founding100_events (
    event_name, reservation_id, source, dedupe_key, created_at
  ) values
    (
      'telegram_start',
      v_reservation.id,
      v_reservation.source,
      'telegram_start:' || v_reservation.id::text,
      p_now
    ),
    (
      'beta_confirmed',
      v_reservation.id,
      v_reservation.source,
      'beta_confirmed:' || v_reservation.id::text,
      p_now
    )
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'duplicate', false
  );
end;
$$;

create function public.record_founding100_event(
  p_event_name text,
  p_source text,
  p_reservation_id uuid default null,
  p_dedupe_key text default null,
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
  if p_reservation_id is not null
     and not exists (
       select 1 from public.founding100_reservations where id = p_reservation_id
     ) then
    raise exception 'founding100 reservation not found' using errcode = 'P0002';
  end if;

  insert into public.founding100_events (
    event_name, reservation_id, source, dedupe_key, created_at
  ) values (
    p_event_name, p_reservation_id, p_source, p_dedupe_key, p_now
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

create function public.record_founding100_onboarding_complete(
  p_user_id uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_reservation public.founding100_reservations%rowtype;
begin
  select * into v_reservation
  from public.founding100_reservations
  where user_id = p_user_id
    and status = 'confirmed'
  order by confirmed_at desc
  limit 1;

  if not found then
    return false;
  end if;

  insert into public.founding100_events (
    event_name, reservation_id, source, dedupe_key, created_at
  ) values (
    'onboarding_complete',
    v_reservation.id,
    v_reservation.source,
    'onboarding_complete:' || v_reservation.id::text,
    p_now
  )
  on conflict (dedupe_key) do nothing;

  return true;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['founding100_reservations', 'founding100_events']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      table_name || '_deny_direct_client_access',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.founding100_status(timestamptz)',
    'public.reserve_founding100_slot(text,text,text,timestamptz)',
    'public.confirm_founding100_reservation(text,uuid,timestamptz)',
    'public.record_founding100_event(text,text,uuid,text,timestamptz)',
    'public.record_founding100_onboarding_complete(uuid,timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

comment on table public.founding100_reservations is
  'Founding 100 capacity ledger. Raw Telegram start tokens are never stored.';
comment on table public.founding100_events is
  'PII-minimized Founding 100 funnel events associated with reservation IDs when available.';

commit;


