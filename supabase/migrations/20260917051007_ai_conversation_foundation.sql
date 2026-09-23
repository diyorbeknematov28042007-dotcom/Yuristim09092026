begin;

create table public.ai_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id text not null unique default (
    'aic_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
  ) check (public_id ~ '^aic_[a-f0-9]{24}$'),
  user_id uuid not null references public.users(id) on delete restrict,
  title text check (title is null or char_length(btrim(title)) between 1 and 120),
  mode text not null default 'fast' check (mode in ('fast', 'expert')),
  status text not null default 'active' check (status in ('active', 'archived')),
  system_prompt_version text not null check (
    char_length(system_prompt_version) between 1 and 40
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  archived_at timestamptz,
  constraint ai_conversation_archive_state check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  )
);

create table public.ai_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id text not null unique default (
    'aim_' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)
  ) check (public_id ~ '^aim_[a-f0-9]{24}$'),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  request_message_id uuid references public.ai_messages(id) on delete restrict,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '' check (char_length(content) <= 100000),
  mode text not null check (mode in ('fast', 'expert')),
  provider text check (
    provider is null or (char_length(provider) between 2 and 40 and provider ~ '^[a-z][a-z0-9_-]+$')
  ),
  model text check (model is null or char_length(model) between 1 and 120),
  status text not null check (
    status in ('pending', 'running', 'streaming', 'completed', 'failed', 'cancelled')
  ),
  source_status text not null default 'none' check (
    source_status in ('none', 'available', 'unverified')
  ),
  system_prompt_version text not null check (
    char_length(system_prompt_version) between 1 and 40
  ),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  provider_cost_usd numeric(18, 8) check (
    provider_cost_usd is null or provider_cost_usd >= 0
  ),
  charged_credits numeric(14, 3) not null default 0 check (charged_credits >= 0),
  refunded_credits numeric(14, 3) not null default 0 check (
    refunded_credits >= 0 and refunded_credits <= charged_credits
  ),
  error_code text check (
    error_code is null or (char_length(error_code) between 2 and 80 and error_code ~ '^[a-z][a-z0-9_]+$')
  ),
  idempotency_key text check (
    idempotency_key is null or char_length(idempotency_key) between 8 and 160
  ),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_message_request_role check (
    (role = 'user' and request_message_id is null and idempotency_key is not null)
    or (role = 'assistant' and request_message_id is not null and idempotency_key is null)
  ),
  constraint ai_message_provider_role check (
    (role = 'user' and provider is null and model is null)
    or (role = 'assistant' and provider is not null and model is not null)
  ),
  constraint ai_message_user_state check (
    role <> 'user'
    or (
      status = 'completed'
      and char_length(btrim(content)) between 1 and 12000
      and completed_at is not null
      and charged_credits = 0
      and refunded_credits = 0
      and error_code is null
    )
  ),
  constraint ai_message_assistant_completion check (
    role <> 'assistant'
    or status not in ('completed', 'failed', 'cancelled')
    or completed_at is not null
  ),
  constraint ai_message_success_usage check (
    status <> 'completed'
    or (
      char_length(btrim(content)) > 0
      and input_tokens is not null
      and output_tokens is not null
      and provider_cost_usd is not null
      and charged_credits >= 1
      and refunded_credits = 0
      and error_code is null
    )
  ),
  constraint ai_message_failure_net_charge check (
    status <> 'failed' or charged_credits = refunded_credits
  )
);

alter table public.ai_messages
  add constraint ai_messages_request_message_unique unique (request_message_id);

create unique index ai_messages_idempotency_idx
  on public.ai_messages (conversation_id, idempotency_key)
  where role = 'user';
create index ai_messages_conversation_history_idx
  on public.ai_messages (conversation_id, created_at, id);
create index ai_messages_active_request_idx
  on public.ai_messages (conversation_id, status)
  where role = 'assistant' and status in ('pending', 'running', 'streaming');
create index ai_conversations_user_history_idx
  on public.ai_conversations (user_id, status, last_message_at desc nulls last, created_at desc);

create table public.ai_message_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  message_id uuid not null references public.ai_messages(id) on delete cascade,
  citation_order integer not null check (citation_order between 1 and 100),
  title text not null check (char_length(btrim(title)) between 1 and 500),
  url text not null check (char_length(url) between 8 and 2048 and url ~ '^https://'),
  source_type text not null check (
    source_type in ('official_legal', 'official_government', 'court', 'secondary', 'other')
  ),
  publisher text check (publisher is null or char_length(btrim(publisher)) between 1 and 200),
  domain text check (domain is null or char_length(domain) between 1 and 253),
  is_official boolean not null default false,
  verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (message_id, citation_order),
  unique (message_id, url)
);

create index ai_message_sources_message_idx
  on public.ai_message_sources (message_id, citation_order);

create table public.ai_user_states (
  user_id uuid primary key references public.users(id) on delete cascade,
  active_conversation_id uuid references public.ai_conversations(id) on delete set null,
  preferred_mode text not null default 'fast' check (preferred_mode in ('fast', 'expert')),
  bot_chat_active boolean not null default false,
  updated_at timestamptz not null default now()
);

create index ai_user_states_active_conversation_idx
  on public.ai_user_states (active_conversation_id)
  where active_conversation_id is not null;

create trigger ai_conversations_set_updated_at
before update on public.ai_conversations
for each row execute function app_private.set_updated_at();

create trigger ai_user_states_set_updated_at
before update on public.ai_user_states
for each row execute function app_private.set_updated_at();

create function app_private.validate_ai_message_transition()
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
     or old.provider <> new.provider
     or old.model <> new.model
     or old.system_prompt_version <> new.system_prompt_version
     or old.created_at <> new.created_at then
    raise exception 'immutable AI message fields cannot change' using errcode = '22023';
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

revoke all on function app_private.validate_ai_message_transition() from public, anon, authenticated;

create trigger ai_messages_validate_transition
before update on public.ai_messages
for each row execute function app_private.validate_ai_message_transition();

create function public.create_ai_conversation(
  p_user_id uuid,
  p_mode text,
  p_system_prompt_version text,
  p_now timestamptz default now()
)
returns public.ai_conversations
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_conversation public.ai_conversations%rowtype;
begin
  if p_mode not in ('fast', 'expert') then
    raise exception 'invalid AI mode' using errcode = '22023';
  end if;
  if p_system_prompt_version is null
     or char_length(p_system_prompt_version) not between 1 and 40 then
    raise exception 'invalid system prompt version' using errcode = '22023';
  end if;

  insert into public.ai_conversations (
    user_id, mode, system_prompt_version, created_at, updated_at
  ) values (
    p_user_id, p_mode, p_system_prompt_version, p_now, p_now
  ) returning * into v_conversation;

  insert into public.ai_user_states (
    user_id, active_conversation_id, preferred_mode, bot_chat_active, updated_at
  ) values (
    p_user_id, v_conversation.id, p_mode, true, p_now
  )
  on conflict (user_id) do update set
    active_conversation_id = excluded.active_conversation_id,
    preferred_mode = excluded.preferred_mode,
    bot_chat_active = true,
    updated_at = excluded.updated_at;

  return v_conversation;
end;
$$;

create function public.begin_ai_message(
  p_user_id uuid,
  p_conversation_id uuid,
  p_content text,
  p_mode text,
  p_idempotency_key text,
  p_provider text,
  p_model text,
  p_system_prompt_version text,
  p_title text,
  p_streaming boolean default false,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_conversation public.ai_conversations%rowtype;
  v_user_message public.ai_messages%rowtype;
  v_assistant_message public.ai_messages%rowtype;
begin
  if p_content is null or char_length(btrim(p_content)) not between 1 and 12000 then
    raise exception 'invalid AI prompt' using errcode = '22023';
  end if;
  if p_mode not in ('fast', 'expert') or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 8 and 160 then
    raise exception 'invalid AI request metadata' using errcode = '22023';
  end if;
  if p_provider is null or p_model is null or p_system_prompt_version is null then
    raise exception 'AI provider metadata is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai-conversation:' || p_conversation_id::text, 0));
  select * into v_conversation
  from public.ai_conversations
  where id = p_conversation_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'AI conversation not found' using errcode = 'P0002';
  end if;
  if v_conversation.status <> 'active' then
    raise exception 'AI conversation is archived' using errcode = '22023';
  end if;

  select * into v_user_message
  from public.ai_messages
  where conversation_id = p_conversation_id
    and role = 'user'
    and idempotency_key = p_idempotency_key
  limit 1;
  if found then
    select * into v_assistant_message
    from public.ai_messages
    where request_message_id = v_user_message.id;
    return jsonb_build_object(
      'duplicate', true,
      'userMessage', to_jsonb(v_user_message),
      'assistantMessage', to_jsonb(v_assistant_message)
    );
  end if;

  if exists (
    select 1 from public.ai_messages
    where conversation_id = p_conversation_id
      and role = 'assistant'
      and status in ('pending', 'running', 'streaming')
  ) then
    raise exception 'AI conversation already has an active request' using errcode = 'P0004';
  end if;

  insert into public.ai_messages (
    conversation_id, role, content, mode, status, source_status,
    system_prompt_version, idempotency_key, created_at, completed_at
  ) values (
    p_conversation_id, 'user', btrim(p_content), p_mode, 'completed', 'none',
    p_system_prompt_version, p_idempotency_key, p_now, p_now
  ) returning * into v_user_message;

  insert into public.ai_messages (
    conversation_id, request_message_id, role, mode, provider, model, status,
    source_status, system_prompt_version, created_at
  ) values (
    p_conversation_id, v_user_message.id, 'assistant', p_mode, p_provider, p_model,
    case when p_streaming then 'streaming' else 'running' end,
    'none', p_system_prompt_version, p_now
  ) returning * into v_assistant_message;

  update public.ai_conversations
  set mode = p_mode,
      title = coalesce(title, nullif(btrim(p_title), '')),
      last_message_at = p_now,
      updated_at = p_now
  where id = p_conversation_id;

  insert into public.ai_user_states (
    user_id, active_conversation_id, preferred_mode, bot_chat_active, updated_at
  ) values (
    p_user_id, p_conversation_id, p_mode, true, p_now
  )
  on conflict (user_id) do update set
    active_conversation_id = excluded.active_conversation_id,
    preferred_mode = excluded.preferred_mode,
    bot_chat_active = true,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'duplicate', false,
    'userMessage', to_jsonb(v_user_message),
    'assistantMessage', to_jsonb(v_assistant_message)
  );
end;
$$;

create function public.complete_ai_message(
  p_user_id uuid,
  p_message_id uuid,
  p_content text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_provider_cost_usd numeric,
  p_charged_credits numeric,
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
  if p_content is null or char_length(btrim(p_content)) < 1
     or char_length(p_content) > 100000
     or p_input_tokens < 0 or p_output_tokens < 0
     or p_provider_cost_usd < 0 or p_charged_credits < 1 then
    raise exception 'invalid AI completion' using errcode = '22023';
  end if;

  select message.* into v_message
  from public.ai_messages message
  join public.ai_conversations conversation on conversation.id = message.conversation_id
  where message.id = p_message_id
    and message.role = 'assistant'
    and conversation.user_id = p_user_id
  for update of message;
  if not found then
    raise exception 'AI message not found' using errcode = 'P0002';
  end if;
  if v_message.status = 'completed' then
    return v_message;
  end if;
  if v_message.status not in ('pending', 'running', 'streaming') then
    raise exception 'AI message cannot be completed' using errcode = '22023';
  end if;

  perform public.debit_credits(
    p_user_id,
    round(p_charged_credits, 3),
    'ai_usage',
    'ai_message',
    v_message.public_id,
    'Yuristim AI usage',
    p_now
  );

  update public.ai_messages
  set content = btrim(p_content),
      status = 'completed',
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      provider_cost_usd = p_provider_cost_usd,
      charged_credits = round(p_charged_credits, 3),
      completed_at = p_now
  where id = p_message_id
  returning * into v_message;

  update public.ai_conversations
  set last_message_at = p_now, updated_at = p_now
  where id = v_message.conversation_id;

  return v_message;
end;
$$;

create function public.fail_ai_message(
  p_user_id uuid,
  p_message_id uuid,
  p_error_code text,
  p_cancelled boolean default false,
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
  if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]+$'
     or char_length(p_error_code) > 80 then
    raise exception 'invalid AI error code' using errcode = '22023';
  end if;
  select message.* into v_message
  from public.ai_messages message
  join public.ai_conversations conversation on conversation.id = message.conversation_id
  where message.id = p_message_id
    and message.role = 'assistant'
    and conversation.user_id = p_user_id
  for update of message;
  if not found then
    raise exception 'AI message not found' using errcode = 'P0002';
  end if;
  if v_message.status in ('failed', 'cancelled') then
    return v_message;
  end if;
  if v_message.status not in ('pending', 'running', 'streaming') then
    raise exception 'AI message cannot fail' using errcode = '22023';
  end if;

  update public.ai_messages
  set status = case when p_cancelled then 'cancelled' else 'failed' end,
      error_code = p_error_code,
      completed_at = p_now
  where id = p_message_id
  returning * into v_message;
  return v_message;
end;
$$;

create function public.reverse_ai_delivery_charge(
  p_user_id uuid,
  p_message_id uuid,
  p_now timestamptz default now()
)
returns public.ai_messages
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_message public.ai_messages%rowtype;
  v_transaction record;
  v_refunded numeric := 0;
begin
  select message.* into v_message
  from public.ai_messages message
  join public.ai_conversations conversation on conversation.id = message.conversation_id
  where message.id = p_message_id
    and message.role = 'assistant'
    and conversation.user_id = p_user_id
  for update of message;
  if not found then
    raise exception 'AI message not found' using errcode = 'P0002';
  end if;
  if v_message.status = 'failed' and v_message.error_code = 'delivery_failed' then
    return v_message;
  end if;
  if v_message.status <> 'completed' or v_message.charged_credits < 1 then
    raise exception 'AI message has no reversible completion' using errcode = '22023';
  end if;

  for v_transaction in
    select bucket_type, expires_at, -sum(amount)::numeric as amount
    from public.credit_transactions
    where user_id = p_user_id
      and type = 'ai_usage'
      and source = 'ai_message'
      and reference_id = v_message.public_id
      and amount < 0
    group by bucket_type, expires_at
  loop
    perform public.grant_credit(
      p_user_id,
      'reversal',
      v_transaction.bucket_type,
      v_transaction.amount,
      'ai_delivery',
      v_message.public_id,
      v_transaction.expires_at,
      'AI response delivery failed',
      null,
      p_now
    );
    v_refunded := v_refunded + v_transaction.amount;
  end loop;

  if v_refunded <> v_message.charged_credits then
    raise exception 'AI reversal amount mismatch' using errcode = '22023';
  end if;

  update public.ai_messages
  set status = 'failed',
      refunded_credits = v_refunded,
      error_code = 'delivery_failed',
      completed_at = p_now
  where id = p_message_id
  returning * into v_message;
  return v_message;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ai_conversations', 'ai_messages', 'ai_message_sources', 'ai_user_states'
  ]
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
    'public.create_ai_conversation(uuid,text,text,timestamptz)',
    'public.begin_ai_message(uuid,uuid,text,text,text,text,text,text,text,boolean,timestamptz)',
    'public.complete_ai_message(uuid,uuid,text,integer,integer,numeric,numeric,timestamptz)',
    'public.fail_ai_message(uuid,uuid,text,boolean,timestamptz)',
    'public.reverse_ai_delivery_charge(uuid,uuid,timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

comment on table public.ai_conversations is
  'User-owned Yuristim AI conversations. Provider routing is intentionally not exposed here.';
comment on table public.ai_messages is
  'Persistent AI message lifecycle and normalized provider usage; system prompts are not stored as messages.';
comment on table public.ai_message_sources is
  'Citation foundation for verified retrieval. Empty in Phase 7 unless an application-verified source exists.';
comment on table public.ai_user_states is
  'Persistent bot AI session pointer and mode preference; safe across bot restarts.';

commit;
