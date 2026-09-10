begin;

create table public.lawyer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'draft', 'submitted', 'pending_review', 'approved', 'rejected', 'resubmitted')),
  region text,
  experience_years integer check (experience_years between 0 and 70),
  bio text check (bio is null or char_length(bio) between 20 and 1000),
  consultation_price numeric(14, 2) check (consultation_price is null or consultation_price >= 0),
  public_slug text not null unique,
  profile_image_path text,
  rating_average numeric(3, 2) not null default 0 check (rating_average between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  jobs_count integer not null default 0 check (jobs_count >= 0),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.specializations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  name_uz text not null,
  name_ru text not null,
  name_en text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.lawyer_specializations (
  lawyer_id uuid not null references public.lawyer_profiles(id) on delete cascade,
  specialization_id uuid not null references public.specializations(id) on delete restrict,
  primary key (lawyer_id, specialization_id)
);

create table public.lawyer_verifications (
  id uuid primary key default gen_random_uuid(),
  lawyer_id uuid not null references public.lawyer_profiles(id) on delete cascade,
  type text not null check (type in ('initial', 'profile_update')),
  submitted_data jsonb not null default '{}'::jsonb check (jsonb_typeof(submitted_data) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'pending_review', 'approved', 'rejected')),
  reject_reason text check (reject_reason is null or char_length(btrim(reject_reason)) between 3 and 1000),
  reviewed_by uuid,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviewed_verification_is_complete check (
    (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
    or (status not in ('approved', 'rejected') and reviewed_by is null and reviewed_at is null)
  ),
  constraint rejected_verification_has_reason check (
    status <> 'rejected' or reject_reason is not null
  )
);

create unique index lawyer_verifications_one_open_request
  on public.lawyer_verifications (lawyer_id)
  where status in ('draft', 'submitted', 'pending_review');
create index lawyer_verifications_review_queue
  on public.lawyer_verifications (status, submitted_at desc)
  where status in ('submitted', 'pending_review');

create table public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references public.lawyer_verifications(id) on delete cascade,
  kind text not null check (kind in ('profile_image', 'verification_document')),
  storage_bucket text not null check (storage_bucket in ('profile-images', 'lawyer-verification')),
  storage_path text not null unique,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  constraint document_bucket_matches_kind check (
    (kind = 'profile_image' and storage_bucket = 'profile-images')
    or (kind = 'verification_document' and storage_bucket = 'lawyer-verification')
  )
);
create index verification_documents_verification_id_idx
  on public.verification_documents (verification_id);

create table public.admin_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9_.-]{3,64}$'),
  password_hash text not null,
  role text not null default 'admin' check (role in ('admin', 'support')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  failed_login_attempts integer not null default 0 check (failed_login_attempts between 0 and 10),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lawyer_verifications
  add constraint lawyer_verifications_reviewed_by_fkey
  foreign key (reviewed_by) references public.admin_accounts(id);

create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_accounts(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index admin_sessions_admin_id_idx on public.admin_sessions (admin_id);
create index admin_sessions_expires_at_idx on public.admin_sessions (expires_at);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('admin', 'system')),
  actor_id uuid,
  action text not null check (char_length(action) between 1 and 128),
  entity_type text not null check (char_length(entity_type) between 1 and 128),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create table public.admin_login_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admin_accounts(id) on delete set null,
  username text not null,
  success boolean not null,
  ip inet,
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  created_at timestamptz not null default now()
);
create index admin_login_logs_username_idx on public.admin_login_logs (username, created_at desc);

-- The existing shared trigger function has a fixed search path and only sets updated_at.
create trigger lawyer_profiles_set_updated_at
before update on public.lawyer_profiles
for each row execute function app_private.set_updated_at();
create trigger lawyer_verifications_set_updated_at
before update on public.lawyer_verifications
for each row execute function app_private.set_updated_at();
create trigger admin_accounts_set_updated_at
before update on public.admin_accounts
for each row execute function app_private.set_updated_at();

create function public.protect_verification_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status <> 'draft' and new.submitted_data is distinct from old.submitted_data then
    raise exception 'submitted verification snapshot is immutable' using errcode = '22023';
  end if;
  if old.status <> 'draft' and new.type is distinct from old.type then
    raise exception 'submitted verification type is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger lawyer_verifications_protect_snapshot
before update on public.lawyer_verifications
for each row execute function public.protect_verification_snapshot();

create function public.protect_immutable_log()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'audit records are immutable' using errcode = '22023';
end;
$$;

create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function public.protect_immutable_log();
create trigger admin_login_logs_immutable
before update or delete on public.admin_login_logs
for each row execute function public.protect_immutable_log();

insert into public.specializations (code, name_uz, name_ru, name_en) values
  ('civil', 'Fuqarolik huquqi', 'Гражданское право', 'Civil law'),
  ('criminal', 'Jinoyat huquqi', 'Уголовное право', 'Criminal law'),
  ('family', 'Oila huquqi', 'Семейное право', 'Family law'),
  ('labor', 'Mehnat huquqi', 'Трудовое право', 'Labor law'),
  ('administrative', 'Ma’muriy huquq', 'Административное право', 'Administrative law'),
  ('economic', 'Iqtisodiy huquq', 'Экономическое право', 'Economic law'),
  ('tax', 'Soliq huquqi', 'Налоговое право', 'Tax law'),
  ('corporate', 'Korporativ huquq', 'Корпоративное право', 'Corporate law'),
  ('contract', 'Shartnoma huquqi', 'Договорное право', 'Contract law'),
  ('real_estate', 'Ko‘chmas mulk huquqi', 'Право недвижимости', 'Real estate law'),
  ('inheritance', 'Meros huquqi', 'Наследственное право', 'Inheritance law'),
  ('intellectual_property', 'Intellektual mulk huquqi', 'Интеллектуальная собственность', 'Intellectual property law')
on conflict (code) do update set
  name_uz = excluded.name_uz,
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  active = true;

-- Buckets are private; trusted API uploads through the Storage API with the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('lawyer-verification', 'lawyer-verification', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png']),
  ('profile-images', 'profile-images', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.review_lawyer_verification(
  p_verification_id uuid,
  p_admin_id uuid,
  p_decision text,
  p_reject_reason text default null
)
returns table (verification_id uuid, lawyer_id uuid, decision text)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_verification public.lawyer_verifications%rowtype;
  v_profile public.lawyer_profiles%rowtype;
  v_code text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid review decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (p_reject_reason is null or char_length(btrim(p_reject_reason)) < 3) then
    raise exception 'reject reason required' using errcode = '22023';
  end if;

  select * into v_verification
  from public.lawyer_verifications
  where id = p_verification_id
  for update;

  if not found then
    raise exception 'verification not found' using errcode = 'P0002';
  end if;
  if v_verification.status not in ('submitted', 'pending_review') then
    raise exception 'verification already reviewed' using errcode = '40001';
  end if;

  select * into v_profile
  from public.lawyer_profiles
  where id = v_verification.lawyer_id
  for update;

  update public.lawyer_verifications
  set status = p_decision,
      reject_reason = case when p_decision = 'rejected' then btrim(p_reject_reason) else null end,
      reviewed_by = p_admin_id,
      reviewed_at = now()
  where id = p_verification_id;

  if p_decision = 'approved' then
    update public.users
    set full_name = v_verification.submitted_data->>'fullName',
        onboarding_role = 'lawyer'
    where id = v_profile.user_id;

    update public.lawyer_profiles
    set verification_status = 'approved',
        region = v_verification.submitted_data->>'region',
        experience_years = (v_verification.submitted_data->>'experienceYears')::integer,
        bio = v_verification.submitted_data->>'bio',
        consultation_price = nullif(v_verification.submitted_data->>'consultationPrice', '')::numeric,
        profile_image_path = v_verification.submitted_data->>'profileImagePath',
        verified_at = now()
    where id = v_profile.id;

    delete from public.lawyer_specializations where lawyer_id = v_profile.id;
    for v_code in
      select jsonb_array_elements_text(v_verification.submitted_data->'specializationCodes')
    loop
      insert into public.lawyer_specializations (lawyer_id, specialization_id)
      select v_profile.id, id from public.specializations where code = v_code and active
      on conflict do nothing;
    end loop;
  elsif v_verification.type = 'initial' then
    update public.lawyer_profiles
    set verification_status = 'rejected'
    where id = v_profile.id;
  end if;

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (
    'admin', p_admin_id, 'lawyer_verification.' || p_decision,
    'lawyer_verification', p_verification_id,
    jsonb_build_object('lawyerId', v_profile.id, 'type', v_verification.type)
  );

  return query select p_verification_id, v_profile.id, p_decision;
end;
$$;

revoke all on function public.review_lawyer_verification(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_lawyer_verification(uuid, uuid, text, text) to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'lawyer_profiles', 'specializations', 'lawyer_specializations', 'lawyer_verifications',
    'verification_documents', 'admin_accounts', 'admin_sessions', 'audit_logs', 'admin_login_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

commit;
