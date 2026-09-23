begin;

create or replace function public.review_lawyer_verification(
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

    delete from public.lawyer_specializations as ls
    where ls.lawyer_id = v_profile.id;
    for v_code in
      select jsonb_array_elements_text(v_verification.submitted_data->'specializationCodes')
    loop
      insert into public.lawyer_specializations (lawyer_id, specialization_id)
      select v_profile.id, s.id
      from public.specializations as s
      where s.code = v_code and s.active
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

revoke all on function public.review_lawyer_verification(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.review_lawyer_verification(uuid, uuid, text, text)
to service_role;

commit;
