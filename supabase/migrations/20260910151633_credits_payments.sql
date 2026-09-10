begin;

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  type text not null check (type in (
    'purchase', 'welcome_bonus', 'weekly_bonus', 'student_bonus', 'admin_bonus',
    'ai_usage', 'document_usage', 'refund', 'adjustment', 'reversal'
  )),
  bucket_type text not null check (bucket_type in ('paid', 'weekly', 'bonus')),
  amount numeric(14, 3) not null check (amount <> 0),
  balance_after numeric(14, 3) not null check (balance_after >= 0),
  source text check (source is null or char_length(source) between 1 and 80),
  reference_id text check (reference_id is null or char_length(reference_id) between 1 and 160),
  expires_at timestamptz,
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 1000),
  created_by uuid references public.admin_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint credit_bucket_expiry_matches check (
    (bucket_type = 'paid' and expires_at is null)
    or (bucket_type = 'weekly' and expires_at is not null)
    or bucket_type = 'bonus'
  )
);

create index credit_transactions_user_history_idx
  on public.credit_transactions (user_id, created_at desc, id desc);
create index credit_transactions_user_expiry_idx
  on public.credit_transactions (user_id, expires_at)
  where expires_at is not null;
create unique index credit_transactions_idempotency_idx
  on public.credit_transactions (
    user_id,
    type,
    source,
    reference_id,
    bucket_type,
    coalesce(expires_at, 'infinity'::timestamptz)
  )
  where reference_id is not null and source is not null;

create table public.credit_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text not null check (char_length(name) between 1 and 120),
  name_uz text not null check (char_length(name_uz) between 1 and 120),
  name_ru text not null check (char_length(name_ru) between 1 and 120),
  name_en text not null check (char_length(name_en) between 1 and 120),
  credit_amount numeric(14, 3) check (credit_amount is null or credit_amount > 0),
  price numeric(14, 2) check (price is null or price > 0),
  currency text not null default 'UZS' check (currency = 'UZS'),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint active_credit_product_is_sellable check (
    not active or (credit_amount is not null and price is not null)
  )
);

create table public.marketplace_accept_transactions (
  id uuid primary key default gen_random_uuid(),
  lawyer_id uuid not null references public.lawyer_profiles(id) on delete restrict,
  type text not null check (type in ('purchase', 'usage', 'bonus', 'refund', 'adjustment', 'reversal')),
  amount integer not null check (amount <> 0),
  balance_after integer not null check (balance_after >= 0),
  expires_at timestamptz,
  reference_id text check (reference_id is null or char_length(reference_id) between 1 and 160),
  created_at timestamptz not null default now()
);

create index marketplace_accept_transactions_history_idx
  on public.marketplace_accept_transactions (lawyer_id, created_at desc, id desc);
create index marketplace_accept_transactions_expiry_idx
  on public.marketplace_accept_transactions (lawyer_id, expires_at)
  where expires_at is not null;
create unique index marketplace_accept_transactions_idempotency_idx
  on public.marketplace_accept_transactions (
    lawyer_id,
    type,
    reference_id,
    coalesce(expires_at, 'infinity'::timestamptz)
  )
  where reference_id is not null;

create table public.marketplace_accept_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text not null check (char_length(name) between 1 and 120),
  name_uz text not null check (char_length(name_uz) between 1 and 120),
  name_ru text not null check (char_length(name_ru) between 1 and 120),
  name_en text not null check (char_length(name_en) between 1 and 120),
  accept_count integer not null check (accept_count > 0),
  price numeric(14, 2) not null check (price > 0),
  currency text not null default 'UZS' check (currency = 'UZS'),
  expires_in_days integer check (expires_in_days is null or expires_in_days between 1 and 3650),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,39}$'),
  provider_payment_id text,
  type text not null check (type in ('credits', 'marketplace_accepts', 'profile_tariff')),
  amount_money numeric(14, 2) not null check (amount_money > 0),
  currency text not null default 'UZS' check (currency = 'UZS'),
  status text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'cancelled')),
  product_id uuid not null,
  product_code text not null check (char_length(product_code) between 2 and 64),
  product_units numeric(14, 3) not null check (product_units > 0),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  failed_at timestamptz,
  constraint payment_terminal_timestamps_match check (
    (status = 'paid' and paid_at is not null and failed_at is null)
    or (status in ('failed', 'cancelled') and paid_at is null and failed_at is not null)
    or (status in ('created', 'pending') and paid_at is null and failed_at is null)
  ),
  constraint accept_payment_units_are_integer check (
    type <> 'marketplace_accepts' or product_units = trunc(product_units)
  )
);

create unique index payments_provider_payment_id_idx
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;
create index payments_user_history_idx on public.payments (user_id, created_at desc);
create index payments_status_idx on public.payments (status, created_at);

create trigger credit_products_set_updated_at
before update on public.credit_products
for each row execute function app_private.set_updated_at();
create trigger marketplace_accept_products_set_updated_at
before update on public.marketplace_accept_products
for each row execute function app_private.set_updated_at();

create function app_private.protect_financial_ledger()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'financial ledger records are immutable' using errcode = '22023';
end;
$$;

revoke all on function app_private.protect_financial_ledger() from public, anon, authenticated;

create trigger credit_transactions_immutable
before update or delete on public.credit_transactions
for each row execute function app_private.protect_financial_ledger();
create trigger marketplace_accept_transactions_immutable
before update or delete on public.marketplace_accept_transactions
for each row execute function app_private.protect_financial_ledger();

create function public.credit_balance(
  p_user_id uuid,
  p_now timestamptz default now()
)
returns table (
  total numeric,
  paid numeric,
  weekly numeric,
  bonus numeric,
  next_expiry timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    coalesce(sum(amount), 0)::numeric as total,
    coalesce(sum(amount) filter (where bucket_type = 'paid'), 0)::numeric as paid,
    coalesce(sum(amount) filter (where bucket_type = 'weekly'), 0)::numeric as weekly,
    coalesce(sum(amount) filter (where bucket_type = 'bonus'), 0)::numeric as bonus,
    min(expires_at) filter (where expires_at > p_now) as next_expiry
  from public.credit_transactions
  where user_id = p_user_id
    and (expires_at is null or expires_at > p_now);
$$;

create function public.grant_credit(
  p_user_id uuid,
  p_type text,
  p_bucket_type text,
  p_amount numeric,
  p_source text,
  p_reference_id text,
  p_expires_at timestamptz default null,
  p_reason text default null,
  p_created_by uuid default null,
  p_now timestamptz default now()
)
returns public.credit_transactions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_existing public.credit_transactions%rowtype;
  v_balance numeric;
  v_row public.credit_transactions%rowtype;
begin
  if p_amount <= 0 then
    raise exception 'credit grant amount must be positive' using errcode = '22023';
  end if;
  if p_type not in ('purchase', 'welcome_bonus', 'weekly_bonus', 'student_bonus', 'admin_bonus', 'refund', 'adjustment', 'reversal') then
    raise exception 'invalid credit grant type' using errcode = '22023';
  end if;
  if p_bucket_type not in ('paid', 'weekly', 'bonus') then
    raise exception 'invalid credit bucket' using errcode = '22023';
  end if;
  if (p_bucket_type = 'paid' and p_expires_at is not null)
     or (p_bucket_type = 'weekly' and p_expires_at is null)
     or (p_expires_at is not null and p_expires_at <= p_now) then
    raise exception 'credit expiry does not match bucket' using errcode = '22023';
  end if;
  if p_source is null or p_reference_id is null then
    raise exception 'credit grants require source and reference' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_existing
  from public.credit_transactions
  where user_id = p_user_id
    and type = p_type
    and source = p_source
    and reference_id = p_reference_id
    and bucket_type = p_bucket_type
    and expires_at is not distinct from p_expires_at
  limit 1;
  if found then
    return v_existing;
  end if;

  select total into v_balance from public.credit_balance(p_user_id, p_now);
  insert into public.credit_transactions (
    user_id, type, bucket_type, amount, balance_after, source, reference_id,
    expires_at, reason, created_by, created_at
  ) values (
    p_user_id, p_type, p_bucket_type, p_amount, v_balance + p_amount, p_source,
    p_reference_id, p_expires_at, nullif(btrim(p_reason), ''), p_created_by, p_now
  ) returning * into v_row;
  return v_row;
end;
$$;

create function public.debit_credits(
  p_user_id uuid,
  p_amount numeric,
  p_type text,
  p_source text,
  p_reference_id text,
  p_reason text default null,
  p_now timestamptz default now()
)
returns setof public.credit_transactions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_available numeric;
  v_remaining numeric;
  v_take numeric;
  v_running numeric;
  v_group record;
  v_row public.credit_transactions%rowtype;
begin
  if p_amount <= 0 then
    raise exception 'credit debit amount must be positive' using errcode = '22023';
  end if;
  if p_type not in ('ai_usage', 'document_usage', 'adjustment', 'reversal') then
    raise exception 'invalid credit debit type' using errcode = '22023';
  end if;
  if p_source is null or p_reference_id is null then
    raise exception 'credit debits require source and reference' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if exists (
    select 1 from public.credit_transactions
    where user_id = p_user_id and type = p_type and source = p_source
      and reference_id = p_reference_id and amount < 0
  ) then
    return query
      select * from public.credit_transactions
      where user_id = p_user_id and type = p_type and source = p_source
        and reference_id = p_reference_id and amount < 0
      order by created_at, id;
    return;
  end if;

  select total into v_available from public.credit_balance(p_user_id, p_now);
  if v_available < p_amount then
    raise exception 'insufficient credits' using errcode = 'P0001';
  end if;

  v_remaining := p_amount;
  v_running := v_available;
  for v_group in
    select
      bucket_type,
      expires_at,
      sum(amount)::numeric as available,
      case
        when bucket_type = 'weekly' then 1
        when bucket_type = 'bonus' and expires_at is not null then 2
        when bucket_type = 'bonus' then 3
        else 4
      end as priority
    from public.credit_transactions
    where user_id = p_user_id
      and (expires_at is null or expires_at > p_now)
    group by bucket_type, expires_at
    having sum(amount) > 0
    order by priority, expires_at nulls last
  loop
    exit when v_remaining = 0;
    v_take := least(v_remaining, v_group.available);
    v_running := v_running - v_take;
    insert into public.credit_transactions (
      user_id, type, bucket_type, amount, balance_after, source, reference_id,
      expires_at, reason, created_at
    ) values (
      p_user_id, p_type, v_group.bucket_type, -v_take, v_running, p_source,
      p_reference_id, v_group.expires_at, nullif(btrim(p_reason), ''), p_now
    ) returning * into v_row;
    return next v_row;
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining <> 0 then
    raise exception 'credit debit allocation failed' using errcode = 'P0001';
  end if;
end;
$$;

create function public.grant_welcome_credit(
  p_user_id uuid,
  p_now timestamptz default now()
)
returns public.credit_transactions
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select public.grant_credit(
    p_user_id, 'welcome_bonus', 'bonus', 50, 'onboarding', 'welcome:v1',
    null, 'Welcome credit', null, p_now
  );
$$;

create function app_private.grant_welcome_credit_on_user_create()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  perform public.grant_welcome_credit(new.id, new.created_at);
  return new;
end;
$$;

revoke all on function app_private.grant_welcome_credit_on_user_create() from public, anon, authenticated;

create trigger users_grant_welcome_credit
after insert on public.users
for each row execute function app_private.grant_welcome_credit_on_user_create();

create function public.grant_weekly_credits(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_user record;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_reference text;
  v_count integer := 0;
  v_before uuid;
  v_after uuid;
begin
  v_period_start := date_trunc('week', p_now at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent';
  v_period_end := (date_trunc('week', p_now at time zone 'Asia/Tashkent') + interval '7 days') at time zone 'Asia/Tashkent';
  v_reference := to_char(v_period_start at time zone 'Asia/Tashkent', 'IYYY-"W"IW');

  for v_user in select id from public.users where status = 'active' order by id
  loop
    select id into v_before from public.credit_transactions
    where user_id = v_user.id and type = 'weekly_bonus' and source = 'weekly_cron'
      and reference_id = v_reference and bucket_type = 'weekly'
      and expires_at = v_period_end;
    select id into v_after from public.grant_credit(
      v_user.id, 'weekly_bonus', 'weekly', 12, 'weekly_cron', v_reference,
      v_period_end, 'Weekly credit', null, greatest(p_now, v_period_start)
    );
    if v_before is null and v_after is not null then
      v_count := v_count + 1;
    end if;
    v_before := null;
    v_after := null;
  end loop;
  return v_count;
end;
$$;

create function public.accept_balance(
  p_lawyer_id uuid,
  p_now timestamptz default now()
)
returns table (balance integer, next_expiry timestamptz)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    coalesce(sum(amount), 0)::integer as balance,
    min(expires_at) filter (where expires_at > p_now) as next_expiry
  from public.marketplace_accept_transactions
  where lawyer_id = p_lawyer_id
    and (expires_at is null or expires_at > p_now);
$$;

create function public.grant_accepts(
  p_lawyer_id uuid,
  p_amount integer,
  p_type text,
  p_reference_id text,
  p_expires_at timestamptz default null,
  p_now timestamptz default now()
)
returns public.marketplace_accept_transactions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_existing public.marketplace_accept_transactions%rowtype;
  v_balance integer;
  v_row public.marketplace_accept_transactions%rowtype;
begin
  if p_amount <= 0 or p_type not in ('purchase', 'bonus', 'refund', 'adjustment', 'reversal') then
    raise exception 'invalid accept grant' using errcode = '22023';
  end if;
  if p_reference_id is null or (p_expires_at is not null and p_expires_at <= p_now) then
    raise exception 'invalid accept reference or expiry' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('accept:' || p_lawyer_id::text, 0));
  select * into v_existing from public.marketplace_accept_transactions
  where lawyer_id = p_lawyer_id and type = p_type and reference_id = p_reference_id
    and expires_at is not distinct from p_expires_at
  limit 1;
  if found then return v_existing; end if;
  select balance into v_balance from public.accept_balance(p_lawyer_id, p_now);
  insert into public.marketplace_accept_transactions (
    lawyer_id, type, amount, balance_after, expires_at, reference_id, created_at
  ) values (
    p_lawyer_id, p_type, p_amount, v_balance + p_amount, p_expires_at, p_reference_id, p_now
  ) returning * into v_row;
  return v_row;
end;
$$;

create function public.debit_accept(
  p_lawyer_id uuid,
  p_reference_id text,
  p_now timestamptz default now()
)
returns public.marketplace_accept_transactions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_group record;
  v_balance integer;
  v_row public.marketplace_accept_transactions%rowtype;
begin
  if p_reference_id is null then
    raise exception 'accept debit reference required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('accept:' || p_lawyer_id::text, 0));
  select * into v_row from public.marketplace_accept_transactions
  where lawyer_id = p_lawyer_id and type = 'usage' and reference_id = p_reference_id
  limit 1;
  if found then return v_row; end if;
  select balance into v_balance from public.accept_balance(p_lawyer_id, p_now);
  if v_balance < 1 then raise exception 'insufficient accepts' using errcode = 'P0001'; end if;
  select expires_at into v_group from public.marketplace_accept_transactions
  where lawyer_id = p_lawyer_id and (expires_at is null or expires_at > p_now)
  group by expires_at
  having sum(amount) > 0
  order by expires_at nulls last
  limit 1;
  insert into public.marketplace_accept_transactions (
    lawyer_id, type, amount, balance_after, expires_at, reference_id, created_at
  ) values (
    p_lawyer_id, 'usage', -1, v_balance - 1, v_group.expires_at, p_reference_id, p_now
  ) returning * into v_row;
  return v_row;
end;
$$;

create function public.process_payment_webhook(
  p_payment_id uuid,
  p_provider text,
  p_provider_payment_id text,
  p_status text,
  p_now timestamptz default now()
)
returns table (payment_id uuid, payment_status text, processed boolean)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_payment public.payments%rowtype;
  v_lawyer_id uuid;
  v_expiry timestamptz;
begin
  if p_status not in ('paid', 'failed', 'cancelled') then
    raise exception 'invalid payment state' using errcode = '22023';
  end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if v_payment.provider <> p_provider then
    raise exception 'payment provider mismatch' using errcode = '22023';
  end if;
  if v_payment.status = p_status then
    return query select v_payment.id, v_payment.status, false;
    return;
  end if;
  if v_payment.status in ('paid', 'failed', 'cancelled') then
    raise exception 'invalid payment state transition' using errcode = '40001';
  end if;

  update public.payments
  set status = p_status,
      provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
      paid_at = case when p_status = 'paid' then p_now else null end,
      failed_at = case when p_status in ('failed', 'cancelled') then p_now else null end
  where id = v_payment.id;

  if p_status = 'paid' then
    if v_payment.type = 'credits' then
      perform public.grant_credit(
        v_payment.user_id, 'purchase', 'paid', v_payment.product_units,
        v_payment.provider, v_payment.id::text, null, 'Credit purchase', null, p_now
      );
    elsif v_payment.type = 'marketplace_accepts' then
      select id into v_lawyer_id from public.lawyer_profiles
      where user_id = v_payment.user_id and verification_status = 'approved';
      if v_lawyer_id is null then
        raise exception 'lawyer not verified' using errcode = '22023';
      end if;
      select case when expires_in_days is null then null else p_now + make_interval(days => expires_in_days) end
      into v_expiry from public.marketplace_accept_products where id = v_payment.product_id;
      perform public.grant_accepts(
        v_lawyer_id, v_payment.product_units::integer, 'purchase', v_payment.id::text,
        v_expiry, p_now
      );
    else
      raise exception 'unsupported payment type' using errcode = '22023';
    end if;
  end if;

  insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  values (
    'system', 'payment.' || p_status, 'payment', v_payment.id,
    jsonb_build_object('provider', v_payment.provider, 'type', v_payment.type)
  );
  return query select v_payment.id, p_status, true;
end;
$$;

create function public.grant_admin_credit_bonus(
  p_user_id uuid,
  p_admin_id uuid,
  p_amount numeric,
  p_reason text,
  p_reference_id text,
  p_now timestamptz default now()
)
returns public.credit_transactions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_row public.credit_transactions%rowtype;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'admin credit reason required' using errcode = '22023';
  end if;
  v_row := public.grant_credit(
    p_user_id, 'admin_bonus', 'bonus', p_amount, 'admin', p_reference_id,
    null, p_reason, p_admin_id, p_now
  );
  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  select 'admin', p_admin_id, 'credits.admin_bonus', 'user', p_user_id,
    jsonb_build_object('amount', p_amount, 'reason', btrim(p_reason), 'transactionId', v_row.id)
  where not exists (
    select 1 from public.audit_logs
    where actor_id = p_admin_id and action = 'credits.admin_bonus'
      and entity_type = 'user' and entity_id = p_user_id
      and metadata->>'transactionId' = v_row.id::text
  );
  return v_row;
end;
$$;

insert into public.credit_products (
  code, name, name_uz, name_ru, name_en, credit_amount, price, currency, active
) values
  ('credits_100', '100 credits', '100 kredit', '100 кредитов', '100 credits', 100, null, 'UZS', false),
  ('credits_250', '250 credits', '250 kredit', '250 кредитов', '250 credits', 250, null, 'UZS', false),
  ('credits_1000', '1000 credits', '1000 kredit', '1000 кредитов', '1000 credits', 1000, null, 'UZS', false),
  ('enterprise', 'Enterprise', 'Enterprise', 'Enterprise', 'Enterprise', null, null, 'UZS', false)
on conflict (code) do nothing;

insert into public.marketplace_accept_products (
  code, name, name_uz, name_ru, name_en, accept_count, price, currency, expires_in_days, active
) values (
  'single_accept', '1 marketplace accept', '1 ta e’lonni qabul qilish',
  '1 принятие объявления', '1 marketplace accept', 1, 9900, 'UZS', null, true
)
on conflict (code) do update set
  name = excluded.name,
  name_uz = excluded.name_uz,
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  accept_count = excluded.accept_count,
  price = excluded.price,
  currency = excluded.currency,
  expires_in_days = excluded.expires_in_days,
  active = true;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'credit_transactions', 'credit_products', 'marketplace_accept_transactions',
    'marketplace_accept_products', 'payments'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.credit_balance(uuid,timestamptz)',
    'public.grant_credit(uuid,text,text,numeric,text,text,timestamptz,text,uuid,timestamptz)',
    'public.debit_credits(uuid,numeric,text,text,text,text,timestamptz)',
    'public.grant_welcome_credit(uuid,timestamptz)',
    'public.grant_weekly_credits(timestamptz)',
    'public.accept_balance(uuid,timestamptz)',
    'public.grant_accepts(uuid,integer,text,text,timestamptz,timestamptz)',
    'public.debit_accept(uuid,text,timestamptz)',
    'public.process_payment_webhook(uuid,text,text,text,timestamptz)',
    'public.grant_admin_credit_bonus(uuid,uuid,numeric,text,text,timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

comment on table public.credit_transactions is 'Immutable source-of-truth ledger for Yuristim credits.';
comment on table public.marketplace_accept_transactions is 'Immutable ledger for lawyer marketplace accept units.';
comment on table public.payments is 'Provider-neutral payment lifecycle; grants occur only after verified webhook processing.';
comment on function public.grant_weekly_credits(timestamptz) is 'Idempotent weekly grant using Monday 00:00 Asia/Tashkent boundaries.';

commit;
