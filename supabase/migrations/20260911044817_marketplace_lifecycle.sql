begin;

create table public.marketplace_posts (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique
    check (public_id ~ '^mp_[A-Za-z0-9_-]{20,48}$'),
  user_id uuid not null references public.users(id) on delete restrict,
  specialization_id uuid references public.specializations(id) on delete restrict,
  description text check (description is null or char_length(btrim(description)) between 20 and 1500),
  region text check (region is null or char_length(btrim(region)) between 2 and 120),
  language text not null default 'uz' check (language in ('uz', 'ru', 'en')),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'selected', 'cancelled', 'expired')),
  draft_step text not null default 'specialization'
    check (draft_step in ('specialization', 'description', 'region', 'preview', 'complete')),
  max_acceptances smallint not null default 5 check (max_acceptances between 1 and 5),
  selected_acceptance_id uuid,
  channel_message_id bigint,
  publish_status text not null default 'pending'
    check (publish_status in ('pending', 'published', 'failed')),
  publish_attempts smallint not null default 0 check (publish_attempts between 0 and 100),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  expires_at timestamptz,
  published_at timestamptz,
  selected_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_post_open_data_complete check (
    status = 'draft' or (specialization_id is not null and description is not null)
  ),
  constraint marketplace_post_state_timestamps check (
    (status = 'selected' and selected_at is not null and selected_acceptance_id is not null)
    or (status = 'cancelled' and cancelled_at is not null and selected_acceptance_id is null)
    or (status in ('draft', 'open', 'expired') and selected_at is null and cancelled_at is null)
  ),
  unique (user_id, idempotency_key)
);

create index marketplace_posts_owner_history_idx
  on public.marketplace_posts (user_id, created_at desc, id desc);
create index marketplace_posts_open_idx
  on public.marketplace_posts (created_at desc)
  where status = 'open';
create index marketplace_posts_expiry_idx
  on public.marketplace_posts (expires_at)
  where status = 'open' and expires_at is not null;

create table public.marketplace_acceptances (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique
    check (public_id ~ '^ma_[A-Za-z0-9_-]{20,48}$'),
  marketplace_post_id uuid not null references public.marketplace_posts(id) on delete restrict,
  lawyer_id uuid not null references public.lawyer_profiles(id) on delete restrict,
  status text not null default 'accepted'
    check (status in ('accepted', 'selected', 'not_selected', 'cancelled')),
  ledger_transaction_id uuid not null unique
    references public.marketplace_accept_transactions(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  selected_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_acceptance_state_timestamps check (
    (status = 'selected' and selected_at is not null and closed_at is null)
    or (status in ('not_selected', 'cancelled') and selected_at is null and closed_at is not null)
    or (status = 'accepted' and selected_at is null and closed_at is null)
  ),
  unique (marketplace_post_id, lawyer_id)
);

alter table public.marketplace_posts
  add constraint marketplace_posts_selected_acceptance_fkey
  foreign key (selected_acceptance_id)
  references public.marketplace_acceptances(id)
  on delete restrict;

create index marketplace_acceptances_post_idx
  on public.marketplace_acceptances (marketplace_post_id, accepted_at, id);
create index marketplace_acceptances_lawyer_history_idx
  on public.marketplace_acceptances (lawyer_id, accepted_at desc, id desc);

create table public.marketplace_reviews (
  id uuid primary key default gen_random_uuid(),
  marketplace_post_id uuid not null unique references public.marketplace_posts(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  lawyer_id uuid not null references public.lawyer_profiles(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(btrim(comment)) between 2 and 500),
  created_at timestamptz not null default now()
);

create index marketplace_reviews_lawyer_idx
  on public.marketplace_reviews (lawyer_id, created_at desc);

create trigger marketplace_posts_set_updated_at
before update on public.marketplace_posts
for each row execute function app_private.set_updated_at();
create trigger marketplace_acceptances_set_updated_at
before update on public.marketplace_acceptances
for each row execute function app_private.set_updated_at();
create trigger marketplace_reviews_immutable
before update or delete on public.marketplace_reviews
for each row execute function app_private.protect_financial_ledger();

create function public.publish_marketplace_post(
  p_user_id uuid,
  p_public_id text,
  p_now timestamptz default now(),
  p_expires_at timestamptz default null
)
returns public.marketplace_posts
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_post public.marketplace_posts%rowtype;
begin
  select * into v_post
  from public.marketplace_posts
  where public_id = p_public_id
  for update;

  if not found then raise exception 'marketplace post not found' using errcode = 'P0002'; end if;
  if v_post.user_id <> p_user_id then raise exception 'marketplace post forbidden' using errcode = '42501'; end if;
  if v_post.status = 'open' then return v_post; end if;
  if v_post.status <> 'draft' then raise exception 'marketplace post is closed' using errcode = '40001'; end if;
  if v_post.specialization_id is null or v_post.description is null then
    raise exception 'marketplace post is incomplete' using errcode = '22023';
  end if;

  update public.marketplace_posts
  set status = 'open', draft_step = 'complete', publish_status = 'pending',
      expires_at = coalesce(p_expires_at, p_now + interval '7 days')
  where id = v_post.id
  returning * into v_post;
  return v_post;
end;
$$;

create function public.record_marketplace_publication(
  p_public_id text,
  p_channel_message_id bigint,
  p_now timestamptz default now()
)
returns public.marketplace_posts
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_post public.marketplace_posts%rowtype;
begin
  if p_channel_message_id <= 0 then
    raise exception 'invalid Telegram channel message id' using errcode = '22023';
  end if;
  update public.marketplace_posts
  set channel_message_id = coalesce(channel_message_id, p_channel_message_id),
      publish_status = 'published', published_at = coalesce(published_at, p_now),
      publish_attempts = publish_attempts + case when channel_message_id is null then 1 else 0 end
  where public_id = p_public_id and status <> 'draft'
  returning * into v_post;
  if not found then raise exception 'marketplace post not found' using errcode = 'P0002'; end if;
  return v_post;
end;
$$;

create function public.record_marketplace_publication_failure(p_public_id text)
returns public.marketplace_posts
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_post public.marketplace_posts%rowtype;
begin
  update public.marketplace_posts
  set publish_status = 'failed', publish_attempts = publish_attempts + 1
  where public_id = p_public_id and status = 'open' and channel_message_id is null
  returning * into v_post;
  if not found then raise exception 'marketplace post not found' using errcode = 'P0002'; end if;
  return v_post;
end;
$$;

create function public.accept_marketplace_post(
  p_user_id uuid,
  p_public_id text,
  p_acceptance_public_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_post public.marketplace_posts%rowtype;
  v_user public.users%rowtype;
  v_lawyer public.lawyer_profiles%rowtype;
  v_existing public.marketplace_acceptances%rowtype;
  v_acceptance public.marketplace_acceptances%rowtype;
  v_ledger public.marketplace_accept_transactions%rowtype;
  v_count integer;
begin
  if p_acceptance_public_id !~ '^ma_[A-Za-z0-9_-]{20,48}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DEEP_LINK');
  end if;

  select * into v_post from public.marketplace_posts where public_id = p_public_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_POST_NOT_FOUND'); end if;

  select lp.* into v_lawyer
  from public.lawyer_profiles lp
  join public.users u on u.id = lp.user_id
  where lp.user_id = p_user_id;

  if found then
    select * into v_existing
    from public.marketplace_acceptances
    where marketplace_post_id = v_post.id and lawyer_id = v_lawyer.id;
    if found then
      select count(*)::integer into v_count
      from public.marketplace_acceptances where marketplace_post_id = v_post.id;
      return jsonb_build_object(
        'ok', true, 'duplicate', true, 'acceptanceId', v_existing.id,
        'acceptancePublicId', v_existing.public_id, 'postId', v_post.id,
        'postPublicId', v_post.public_id, 'acceptanceCount', v_count,
        'maxAcceptances', v_post.max_acceptances, 'postStatus', v_post.status,
        'ledgerTransactionId', v_existing.ledger_transaction_id
      );
    end if;
  end if;

  if v_post.status = 'open' and v_post.expires_at is not null and v_post.expires_at <= p_now then
    update public.marketplace_posts set status = 'expired' where id = v_post.id;
    return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_POST_CLOSED');
  end if;
  if v_post.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_POST_CLOSED');
  end if;

  select * into v_user from public.users where id = p_user_id;
  if not found or v_user.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  end if;
  if v_user.onboarding_role <> 'lawyer' then
    return jsonb_build_object('ok', false, 'code', 'LAWYER_ROLE_REQUIRED');
  end if;
  if v_user.active_mode <> 'lawyer' then
    return jsonb_build_object('ok', false, 'code', 'LAWYER_MODE_REQUIRED');
  end if;
  if v_lawyer.id is null or v_lawyer.verification_status <> 'approved' then
    return jsonb_build_object('ok', false, 'code', 'LAWYER_NOT_VERIFIED');
  end if;
  if v_post.user_id = p_user_id then
    return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_OWN_POST');
  end if;

  select count(*)::integer into v_count
  from public.marketplace_acceptances where marketplace_post_id = v_post.id;
  if v_count >= v_post.max_acceptances then
    return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_CAPACITY_FULL');
  end if;

  begin
    v_ledger := public.debit_accept(v_lawyer.id, 'marketplace:' || v_post.id::text, p_now);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_ACCEPT_BALANCE');
  end;

  insert into public.marketplace_acceptances (
    public_id, marketplace_post_id, lawyer_id, ledger_transaction_id, accepted_at
  ) values (
    p_acceptance_public_id, v_post.id, v_lawyer.id, v_ledger.id, p_now
  ) returning * into v_acceptance;

  v_count := v_count + 1;
  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'acceptanceId', v_acceptance.id,
    'acceptancePublicId', v_acceptance.public_id, 'postId', v_post.id,
    'postPublicId', v_post.public_id, 'acceptanceCount', v_count,
    'maxAcceptances', v_post.max_acceptances, 'postStatus', v_post.status,
    'ledgerTransactionId', v_ledger.id
  );
end;
$$;

create function public.select_marketplace_lawyer(
  p_user_id uuid,
  p_post_public_id text,
  p_acceptance_public_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_post public.marketplace_posts%rowtype;
  v_acceptance public.marketplace_acceptances%rowtype;
begin
  select * into v_post
  from public.marketplace_posts where public_id = p_post_public_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_POST_NOT_FOUND'); end if;
  if v_post.user_id <> p_user_id then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;

  select * into v_acceptance
  from public.marketplace_acceptances
  where public_id = p_acceptance_public_id and marketplace_post_id = v_post.id;
  if not found then return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_ACCEPTANCE_NOT_FOUND'); end if;

  if v_post.status = 'selected' and v_post.selected_acceptance_id = v_acceptance.id then
    return jsonb_build_object('ok', true, 'duplicate', true, 'postId', v_post.id,
      'postPublicId', v_post.public_id, 'acceptanceId', v_acceptance.id,
      'acceptancePublicId', v_acceptance.public_id, 'lawyerId', v_acceptance.lawyer_id);
  end if;
  if v_post.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_POST_CLOSED'); end if;
  if v_acceptance.status <> 'accepted' then
    return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_ACCEPTANCE_NOT_FOUND');
  end if;

  update public.marketplace_acceptances
  set status = 'not_selected', closed_at = p_now
  where marketplace_post_id = v_post.id and id <> v_acceptance.id and status = 'accepted';
  update public.marketplace_acceptances
  set status = 'selected', selected_at = p_now
  where id = v_acceptance.id;
  update public.marketplace_posts
  set status = 'selected', selected_acceptance_id = v_acceptance.id, selected_at = p_now
  where id = v_post.id;
  update public.lawyer_profiles set jobs_count = jobs_count + 1 where id = v_acceptance.lawyer_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'postId', v_post.id,
    'postPublicId', v_post.public_id, 'acceptanceId', v_acceptance.id,
    'acceptancePublicId', v_acceptance.public_id, 'lawyerId', v_acceptance.lawyer_id);
end;
$$;

create function public.cancel_marketplace_post(
  p_user_id uuid,
  p_public_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_post public.marketplace_posts%rowtype;
begin
  select * into v_post from public.marketplace_posts where public_id = p_public_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_POST_NOT_FOUND'); end if;
  if v_post.user_id <> p_user_id then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if v_post.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'postId', v_post.id, 'postPublicId', v_post.public_id);
  end if;
  if v_post.status <> 'open' and v_post.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_POST_CLOSED');
  end if;
  update public.marketplace_acceptances
  set status = 'cancelled', closed_at = p_now
  where marketplace_post_id = v_post.id and status = 'accepted';
  update public.marketplace_posts
  set status = 'cancelled', cancelled_at = p_now, selected_acceptance_id = null
  where id = v_post.id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'postId', v_post.id, 'postPublicId', v_post.public_id);
end;
$$;

create function public.submit_marketplace_review(
  p_user_id uuid,
  p_post_public_id text,
  p_rating smallint,
  p_comment text default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_post public.marketplace_posts%rowtype;
  v_acceptance public.marketplace_acceptances%rowtype;
  v_review public.marketplace_reviews%rowtype;
begin
  if p_rating < 1 or p_rating > 5 or (p_comment is not null and char_length(btrim(p_comment)) not between 2 and 500) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REVIEW');
  end if;
  select * into v_post from public.marketplace_posts where public_id = p_post_public_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'MARKETPLACE_POST_NOT_FOUND'); end if;
  if v_post.user_id <> p_user_id then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if v_post.status <> 'selected' or v_post.selected_acceptance_id is null then
    return jsonb_build_object('ok', false, 'code', 'REVIEW_NOT_ALLOWED');
  end if;
  if exists (select 1 from public.marketplace_reviews where marketplace_post_id = v_post.id) then
    return jsonb_build_object('ok', false, 'code', 'REVIEW_ALREADY_EXISTS');
  end if;
  select * into v_acceptance from public.marketplace_acceptances where id = v_post.selected_acceptance_id;
  insert into public.marketplace_reviews (marketplace_post_id, user_id, lawyer_id, rating, comment, created_at)
  values (v_post.id, p_user_id, v_acceptance.lawyer_id, p_rating, nullif(btrim(p_comment), ''), p_now)
  returning * into v_review;
  update public.lawyer_profiles lp
  set rating_average = stats.average, rating_count = stats.count
  from (
    select round(avg(rating)::numeric, 2) as average, count(*)::integer as count
    from public.marketplace_reviews where lawyer_id = v_acceptance.lawyer_id
  ) stats
  where lp.id = v_acceptance.lawyer_id;
  return jsonb_build_object('ok', true, 'reviewId', v_review.id, 'postId', v_post.id,
    'lawyerId', v_acceptance.lawyer_id, 'rating', v_review.rating);
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'marketplace_posts', 'marketplace_acceptances', 'marketplace_reviews'
  ] loop
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
    'public.publish_marketplace_post(uuid,text,timestamptz,timestamptz)',
    'public.record_marketplace_publication(text,bigint,timestamptz)',
    'public.record_marketplace_publication_failure(text)',
    'public.accept_marketplace_post(uuid,text,text,timestamptz)',
    'public.select_marketplace_lawyer(uuid,text,text,timestamptz)',
    'public.cancel_marketplace_post(uuid,text,timestamptz)',
    'public.submit_marketplace_review(uuid,text,smallint,text,timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

comment on table public.marketplace_posts is 'Private marketplace request lifecycle with opaque public identifiers.';
comment on table public.marketplace_acceptances is 'Exactly-once lawyer acceptances linked to the immutable accept ledger.';
comment on table public.marketplace_reviews is 'One immutable owner review for the selected lawyer per marketplace request.';

commit;

