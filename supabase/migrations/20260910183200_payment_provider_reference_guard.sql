begin;

create or replace function public.process_payment_webhook(
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
  if v_payment.provider_payment_id is not null
     and v_payment.provider_payment_id <> p_provider_payment_id then
    raise exception 'provider payment reference mismatch' using errcode = '22023';
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
      select case
        when expires_in_days is null then null
        else p_now + make_interval(days => expires_in_days)
      end into v_expiry
      from public.marketplace_accept_products where id = v_payment.product_id;
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

revoke all on function public.process_payment_webhook(uuid,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_payment_webhook(uuid,text,text,text,timestamptz)
  to service_role;

commit;
