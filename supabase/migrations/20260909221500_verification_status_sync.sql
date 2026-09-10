begin;

create function public.sync_initial_verification_status()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.type = 'initial' then
    update public.lawyer_profiles
    set verification_status = case
      when new.status = 'draft' then
        case when tg_op = 'INSERT' then 'draft' else verification_status end
      when new.status in ('submitted', 'pending_review') then 'pending_review'
      else verification_status
    end
    where id = new.lawyer_id;
  end if;
  return new;
end;
$$;

create trigger lawyer_verifications_sync_initial_status
after insert or update of status on public.lawyer_verifications
for each row execute function public.sync_initial_verification_status();

revoke all on function public.sync_initial_verification_status() from public, anon, authenticated;

commit;
