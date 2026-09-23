begin;

create function public.restore_initial_verification_status_after_cancel()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  previous_status text;
begin
  if old.type <> 'initial' or old.status <> 'draft' then
    return old;
  end if;

  select status
  into previous_status
  from public.lawyer_verifications
  where lawyer_id = old.lawyer_id
    and type = 'initial'
  order by created_at desc
  limit 1;

  update public.lawyer_profiles
  set verification_status = case
    when previous_status = 'approved' then 'approved'
    when previous_status = 'rejected' then 'rejected'
    when previous_status in ('submitted', 'pending_review') then 'pending_review'
    when previous_status = 'draft' then 'draft'
    else 'unverified'
  end
  where id = old.lawyer_id;

  return old;
end;
$$;

create trigger lawyer_verifications_restore_status_after_cancel
after delete on public.lawyer_verifications
for each row execute function public.restore_initial_verification_status_after_cancel();

revoke all on function public.restore_initial_verification_status_after_cancel()
from public, anon, authenticated;

commit;
