create schema app_private;

revoke all on schema app_private from public, anon, authenticated;

create table public.users (
  id uuid primary key default extensions.gen_random_uuid(),
  telegram_user_id bigint unique not null check (telegram_user_id > 0),
  telegram_username text,
  telegram_first_name text,
  full_name text check (full_name is null or char_length(btrim(full_name)) between 2 and 160),
  language text check (language is null or language in ('uz', 'ru', 'en')),
  active_mode text not null default 'user' check (active_mode in ('user', 'lawyer')),
  onboarding_role text check (onboarding_role is null or onboarding_role in ('user', 'lawyer')),
  onboarding_status text not null default 'language_selection'
    check (onboarding_status in ('language_selection', 'role_selection', 'name_required', 'active')),
  duid text unique not null check (duid ~ '^yr_[A-Za-z0-9_-]{16}$'),
  pin_hash text,
  pin_failed_attempts smallint not null default 0 check (pin_failed_attempts between 0 and 5),
  pin_locked_until timestamptz,
  terms_accepted_at timestamptz,
  terms_version text,
  status text not null default 'active' check (status in ('active', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lawyer_name_required check (onboarding_role <> 'lawyer' or full_name is not null),
  constraint terms_acceptance_complete check (
    (terms_accepted_at is null and terms_version is null)
    or (terms_accepted_at is not null and terms_version is not null)
  )
);

create table public.auth_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text unique not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  constraint session_expiry_after_creation check (expires_at > created_at),
  constraint session_revocation_after_creation check (revoked_at is null or revoked_at >= created_at)
);

create table public.auth_login_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  challenge_hash text unique not null check (challenge_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid references public.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'consumed', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  constraint login_expiry_after_creation check (expires_at > created_at),
  constraint confirmed_login_has_user check (
    status not in ('confirmed', 'consumed')
    or (user_id is not null and confirmed_at is not null)
  ),
  constraint consumed_login_has_timestamp check (
    status <> 'consumed' or consumed_at is not null
  )
);

create table public.user_tags (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tag text not null check (tag ~ '^[a-z][a-z0-9:_-]{1,63}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, tag)
);

create index auth_sessions_user_id_idx on public.auth_sessions(user_id);
create index auth_sessions_expires_at_idx on public.auth_sessions(expires_at);
create index auth_login_requests_status_expires_at_idx
  on public.auth_login_requests(status, expires_at);
create index auth_login_requests_user_id_idx
  on public.auth_login_requests(user_id)
  where user_id is not null;
create index user_tags_user_id_idx on public.user_tags(user_id);
create index user_tags_expires_at_idx
  on public.user_tags(expires_at)
  where expires_at is not null;

create function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function app_private.set_updated_at() from public, anon, authenticated;

create trigger users_set_updated_at
before update on public.users
for each row execute function app_private.set_updated_at();

alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.auth_sessions enable row level security;
alter table public.auth_sessions force row level security;
alter table public.auth_login_requests enable row level security;
alter table public.auth_login_requests force row level security;
alter table public.user_tags enable row level security;
alter table public.user_tags force row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.auth_sessions from anon, authenticated;
revoke all on table public.auth_login_requests from anon, authenticated;
revoke all on table public.user_tags from anon, authenticated;

grant all on table public.users to service_role;
grant all on table public.auth_sessions to service_role;
grant all on table public.auth_login_requests to service_role;
grant all on table public.user_tags to service_role;

comment on table public.users is 'Core Yuristim accounts rooted in Telegram identity.';
comment on column public.users.duid is 'Provisional public identifier; independent of UUID and Telegram ID.';
comment on column public.users.pin_hash is 'Argon2id hash only; a plaintext PIN must never be stored.';
comment on table public.auth_sessions is 'Server-controlled sessions; token_hash stores an HMAC-SHA-256 digest only.';
comment on table public.auth_login_requests is 'Short-lived one-time Telegram login challenges; only challenge hashes are stored.';
comment on table public.user_tags is 'Server-managed user capability and segmentation tags.';
