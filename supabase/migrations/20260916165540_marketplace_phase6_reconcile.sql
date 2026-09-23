begin;

alter table public.marketplace_posts
  add column if not exists additional_details text
  check (additional_details is null or char_length(btrim(additional_details)) between 2 and 1500);

alter table public.marketplace_posts drop constraint marketplace_posts_draft_step_check;
alter table public.marketplace_posts add constraint marketplace_posts_draft_step_check
  check (draft_step in ('specialization', 'description', 'region', 'additional_details', 'preview', 'complete'));

create policy marketplace_posts_deny_client_access
  on public.marketplace_posts for all to anon, authenticated using (false) with check (false);
create policy marketplace_acceptances_deny_client_access
  on public.marketplace_acceptances for all to anon, authenticated using (false) with check (false);
create policy marketplace_reviews_deny_client_access
  on public.marketplace_reviews for all to anon, authenticated using (false) with check (false);

create function public.create_marketplace_draft(
  p_user_id uuid,
  p_public_id text,
  p_idempotency_key text,
  p_language text,
  p_now timestamptz default now()
)
returns public.marketplace_posts
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_post public.marketplace_posts%rowtype;
begin
  if p_public_id !~ '^mp_[A-Za-z0-9_-]{20,48}$'
    or char_length(p_idempotency_key) not between 8 and 160
    or p_language not in ('uz', 'ru', 'en') then
    raise exception 'invalid marketplace draft input' using errcode = '22023';
  end if;
  select * into v_post from public.marketplace_posts
  where user_id = p_user_id and status = 'draft' for update;
  if found then return v_post; end if;
  insert into public.marketplace_posts (
    public_id, user_id, language, status, draft_step, idempotency_key, created_at
  ) values (
    p_public_id, p_user_id, p_language, 'draft', 'specialization', p_idempotency_key, p_now
  ) returning * into v_post;
  return v_post;
exception when unique_violation then
  select * into v_post from public.marketplace_posts
  where user_id = p_user_id and status = 'draft';
  if found then return v_post; end if;
  raise;
end;
$$;

create function public.create_marketplace_post(
  p_user_id uuid,
  p_public_id text,
  p_specialization_code text,
  p_description text,
  p_region text,
  p_additional_details text,
  p_language text,
  p_idempotency_key text,
  p_expires_at timestamptz default null,
  p_now timestamptz default now()
)
returns public.marketplace_posts
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_post public.marketplace_posts%rowtype;
  v_specialization_id uuid;
begin
  if p_public_id !~ '^mp_[A-Za-z0-9_-]{20,48}$'
    or char_length(p_idempotency_key) not between 8 and 160
    or p_language not in ('uz', 'ru', 'en') then
    raise exception 'invalid marketplace post input' using errcode = '22023';
  end if;
  select * into v_post from public.marketplace_posts
  where user_id = p_user_id and idempotency_key = p_idempotency_key for update;
  if found then return v_post; end if;
  select id into v_specialization_id from public.specializations
  where code = p_specialization_code and active;
  if not found then raise exception 'invalid specialization' using errcode = '22023'; end if;
  select * into v_post from public.marketplace_posts
  where user_id = p_user_id and status = 'draft' for update;
  if found then
    update public.marketplace_posts set
      specialization_id = v_specialization_id,
      description = btrim(p_description),
      region = nullif(btrim(p_region), ''),
      additional_details = nullif(btrim(p_additional_details), ''),
      language = p_language,
      status = 'open',
      draft_step = 'complete',
      publish_status = 'pending',
      idempotency_key = p_idempotency_key,
      expires_at = coalesce(p_expires_at, p_now + interval '14 days')
    where id = v_post.id returning * into v_post;
    return v_post;
  end if;
  insert into public.marketplace_posts (
    public_id, user_id, specialization_id, description, region, additional_details,
    language, status, draft_step, publish_status, idempotency_key, expires_at, created_at
  ) values (
    p_public_id, p_user_id, v_specialization_id, btrim(p_description), nullif(btrim(p_region), ''),
    nullif(btrim(p_additional_details), ''), p_language, 'open', 'complete', 'pending',
    p_idempotency_key, coalesce(p_expires_at, p_now + interval '14 days'), p_now
  ) returning * into v_post;
  return v_post;
exception when unique_violation then
  select * into v_post from public.marketplace_posts
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then return v_post; end if;
  raise;
end;
$$;

create function public.expire_marketplace_posts(p_now timestamptz default now())
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  with expired as (
    update public.marketplace_posts
    set status = 'expired'
    where status = 'open' and expires_at is not null and expires_at <= p_now
    returning id
  ), closed as (
    update public.marketplace_acceptances a
    set status = 'not_selected', closed_at = p_now
    from expired e
    where a.marketplace_post_id = e.id and a.status = 'accepted'
    returning a.id
  )
  select count(*)::integer into v_count from expired;
  return v_count;
end;
$$;

do $$
declare function_signature text;
begin
  foreach function_signature in array array[
    'public.create_marketplace_draft(uuid,text,text,text,timestamptz)',
    'public.create_marketplace_post(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz)',
    'public.expire_marketplace_posts(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

commit;
