begin;

create table public.ai_provider_runtime_state (
  provider text primary key check (provider in ('gemini', 'bai', 'openai', 'anthropic')),
  manual_enabled boolean not null default true,
  circuit_state text not null default 'ACTIVE' check (
    circuit_state in ('ACTIVE', 'OPEN', 'HALF_OPEN', 'MANUAL_PAUSED')
  ),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  failure_window_started_at timestamptz,
  paused_until timestamptz,
  cooldown_seconds integer not null default 300 check (cooldown_seconds between 10 and 86400),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_category text check (
    last_error_category is null
    or last_error_category in (
      'timeout', 'rate_limit', 'unavailable', 'invalid_request',
      'configuration', 'cancelled', 'unknown'
    )
  ),
  updated_at timestamptz not null default now(),
  constraint ai_provider_manual_state check (
    manual_enabled or circuit_state = 'MANUAL_PAUSED'
  ),
  constraint ai_provider_pause_state check (
    (circuit_state in ('OPEN', 'HALF_OPEN') and paused_until is not null)
    or (circuit_state not in ('OPEN', 'HALF_OPEN') and paused_until is null)
  )
);

insert into public.ai_provider_runtime_state (provider)
values ('gemini'), ('bai'), ('openai'), ('anthropic');

create table public.ai_provider_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  message_id uuid not null references public.ai_messages(id) on delete cascade,
  provider text not null check (provider in ('gemini', 'bai', 'openai', 'anthropic')),
  model text not null check (char_length(model) between 1 and 120),
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('succeeded', 'failed', 'interrupted')),
  error_category text check (
    error_category is null
    or error_category in (
      'timeout', 'rate_limit', 'unavailable', 'invalid_request',
      'configuration', 'cancelled', 'unknown'
    )
  ),
  latency_ms integer not null check (latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (message_id, attempt_number),
  constraint ai_provider_attempt_result check (
    (status = 'succeeded' and error_category is null
      and input_tokens is not null and output_tokens is not null)
    or (status in ('failed', 'interrupted') and error_category is not null)
  ),
  constraint ai_provider_attempt_time check (completed_at >= started_at)
);

create index ai_provider_attempts_message_idx
  on public.ai_provider_attempts (message_id, attempt_number);
create index ai_provider_attempts_provider_time_idx
  on public.ai_provider_attempts (provider, started_at desc);

create or replace function app_private.validate_ai_message_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.role = 'user' then
    raise exception 'user AI messages are immutable' using errcode = '22023';
  end if;
  if old.conversation_id <> new.conversation_id
     or old.request_message_id <> new.request_message_id
     or old.role <> new.role
     or old.mode <> new.mode
     or old.system_prompt_version <> new.system_prompt_version
     or old.created_at <> new.created_at then
    raise exception 'immutable AI message fields cannot change' using errcode = '22023';
  end if;
  if (old.provider is distinct from new.provider or old.model is distinct from new.model)
     and (
       old.status not in ('pending', 'running', 'streaming')
       or new.status <> old.status
     ) then
    raise exception 'AI provider route cannot change in this state' using errcode = '22023';
  end if;
  if old.status = new.status then
    return new;
  end if;
  if old.status in ('pending', 'running')
     and new.status in ('running', 'streaming', 'completed', 'failed', 'cancelled') then
    return new;
  end if;
  if old.status = 'streaming' and new.status in ('completed', 'failed', 'cancelled') then
    return new;
  end if;
  if old.status = 'completed'
     and new.status = 'failed'
     and new.error_code = 'delivery_failed'
     and new.charged_credits = new.refunded_credits then
    return new;
  end if;
  raise exception 'invalid AI message state transition' using errcode = '22023';
end;
$$;

create function public.route_ai_message(
  p_user_id uuid,
  p_message_id uuid,
  p_provider text,
  p_model text,
  p_now timestamptz default now()
)
returns public.ai_messages
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_message public.ai_messages%rowtype;
begin
  if p_provider not in ('gemini', 'bai', 'openai', 'anthropic')
     or p_model is null or char_length(p_model) not between 1 and 120 then
    raise exception 'invalid AI provider route' using errcode = '22023';
  end if;
  select message.* into v_message
  from public.ai_messages message
  join public.ai_conversations conversation on conversation.id = message.conversation_id
  where message.id = p_message_id
    and message.role = 'assistant'
    and message.status in ('pending', 'running', 'streaming')
    and conversation.user_id = p_user_id
  for update of message;
  if not found then
    raise exception 'AI message not found' using errcode = 'P0002';
  end if;

  update public.ai_messages
  set provider = p_provider, model = p_model
  where id = p_message_id
  returning * into v_message;
  return v_message;
end;
$$;

create function public.acquire_ai_provider(
  p_provider text,
  p_half_open_lease_seconds integer,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_state public.ai_provider_runtime_state%rowtype;
  v_allowed boolean := false;
begin
  if p_provider not in ('gemini', 'bai', 'openai', 'anthropic')
     or p_half_open_lease_seconds not between 5 and 3600 then
    raise exception 'invalid AI provider acquisition' using errcode = '22023';
  end if;
  insert into public.ai_provider_runtime_state (provider)
  values (p_provider)
  on conflict (provider) do nothing;

  select * into v_state
  from public.ai_provider_runtime_state
  where provider = p_provider
  for update;

  if not v_state.manual_enabled or v_state.circuit_state = 'MANUAL_PAUSED' then
    update public.ai_provider_runtime_state
    set manual_enabled = false,
        circuit_state = 'MANUAL_PAUSED',
        paused_until = null,
        updated_at = p_now
    where provider = p_provider
    returning * into v_state;
  elsif v_state.circuit_state = 'ACTIVE' then
    v_allowed := true;
  elsif v_state.paused_until <= p_now then
    update public.ai_provider_runtime_state
    set circuit_state = 'HALF_OPEN',
        paused_until = p_now + make_interval(secs => p_half_open_lease_seconds),
        updated_at = p_now
    where provider = p_provider
    returning * into v_state;
    v_allowed := true;
  end if;

  return jsonb_build_object('allowed', v_allowed, 'state', to_jsonb(v_state));
end;
$$;

create function public.record_ai_provider_success(
  p_provider text,
  p_base_cooldown_seconds integer,
  p_now timestamptz default now()
)
returns public.ai_provider_runtime_state
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_state public.ai_provider_runtime_state%rowtype;
begin
  if p_provider not in ('gemini', 'bai', 'openai', 'anthropic')
     or p_base_cooldown_seconds not between 10 and 86400 then
    raise exception 'invalid AI provider success state' using errcode = '22023';
  end if;
  insert into public.ai_provider_runtime_state (provider, cooldown_seconds)
  values (p_provider, p_base_cooldown_seconds)
  on conflict (provider) do nothing;

  update public.ai_provider_runtime_state
  set circuit_state = case when manual_enabled then 'ACTIVE' else 'MANUAL_PAUSED' end,
      consecutive_failures = 0,
      failure_window_started_at = null,
      paused_until = null,
      cooldown_seconds = p_base_cooldown_seconds,
      last_success_at = p_now,
      last_error_category = null,
      updated_at = p_now
  where provider = p_provider
  returning * into v_state;
  return v_state;
end;
$$;

create function public.record_ai_provider_failure(
  p_provider text,
  p_error_category text,
  p_failure_threshold integer,
  p_failure_window_seconds integer,
  p_base_cooldown_seconds integer,
  p_max_cooldown_seconds integer,
  p_retry_after_seconds integer default null,
  p_now timestamptz default now()
)
returns public.ai_provider_runtime_state
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_state public.ai_provider_runtime_state%rowtype;
  v_failures integer;
  v_open boolean;
  v_cooldown integer;
begin
  if p_provider not in ('gemini', 'bai', 'openai', 'anthropic')
     or p_error_category not in ('timeout', 'rate_limit', 'unavailable', 'configuration', 'unknown')
     or p_failure_threshold not between 1 and 20
     or p_failure_window_seconds not between 10 and 3600
     or p_base_cooldown_seconds not between 10 and 86400
     or p_max_cooldown_seconds < p_base_cooldown_seconds
     or p_max_cooldown_seconds > 86400
     or (p_retry_after_seconds is not null and p_retry_after_seconds < 0) then
    raise exception 'invalid AI provider failure state' using errcode = '22023';
  end if;
  insert into public.ai_provider_runtime_state (provider, cooldown_seconds)
  values (p_provider, p_base_cooldown_seconds)
  on conflict (provider) do nothing;

  select * into v_state
  from public.ai_provider_runtime_state
  where provider = p_provider
  for update;

  if v_state.failure_window_started_at is not null
     and v_state.failure_window_started_at >= p_now - make_interval(secs => p_failure_window_seconds) then
    v_failures := v_state.consecutive_failures + 1;
  else
    v_failures := 1;
  end if;
  v_open := v_state.circuit_state = 'HALF_OPEN'
    or p_error_category in ('rate_limit', 'configuration')
    or v_failures >= p_failure_threshold;
  if v_state.circuit_state = 'HALF_OPEN' then
    v_cooldown := least(
      p_max_cooldown_seconds,
      greatest(p_base_cooldown_seconds, v_state.cooldown_seconds) * 2
    );
  else
    v_cooldown := least(
      p_max_cooldown_seconds,
      greatest(p_base_cooldown_seconds, coalesce(p_retry_after_seconds, 0))
    );
  end if;

  update public.ai_provider_runtime_state
  set circuit_state = case
        when not manual_enabled then 'MANUAL_PAUSED'
        when v_open then 'OPEN'
        else 'ACTIVE'
      end,
      consecutive_failures = v_failures,
      failure_window_started_at = case
        when failure_window_started_at is not null
          and failure_window_started_at >= p_now - make_interval(secs => p_failure_window_seconds)
        then failure_window_started_at
        else p_now
      end,
      paused_until = case
        when manual_enabled and v_open then p_now + make_interval(secs => v_cooldown)
        else null
      end,
      cooldown_seconds = v_cooldown,
      last_failure_at = p_now,
      last_error_category = p_error_category,
      updated_at = p_now
  where provider = p_provider
  returning * into v_state;
  return v_state;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['ai_provider_runtime_state', 'ai_provider_attempts']
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
    'public.route_ai_message(uuid,uuid,text,text,timestamptz)',
    'public.acquire_ai_provider(text,integer,timestamptz)',
    'public.record_ai_provider_success(text,integer,timestamptz)',
    'public.record_ai_provider_failure(text,text,integer,integer,integer,integer,integer,timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

comment on table public.ai_provider_runtime_state is
  'Shared provider circuit-breaker state. Contains no credentials or raw provider errors.';
comment on table public.ai_provider_attempts is
  'Internal per-message provider attempt telemetry. Never exposed in user-facing AI responses.';

commit;
