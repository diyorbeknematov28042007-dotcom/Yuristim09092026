alter table public.users drop constraint users_onboarding_status_check;
alter table public.users drop constraint lawyer_name_required;

update public.users
set onboarding_status = case
  when language is null then 'language_selection'
  when onboarding_role is null then 'role_selection'
  when onboarding_role = 'lawyer' and full_name is null then 'name_required'
  when terms_accepted_at is null then 'terms_acceptance'
  else 'completed'
end;

alter table public.users
  add constraint users_onboarding_status_check check (
    onboarding_status in (
      'language_selection',
      'role_selection',
      'name_required',
      'terms_acceptance',
      'completed'
    )
  ),
  add constraint completed_onboarding_is_valid check (
    onboarding_status <> 'completed'
    or (
      language is not null
      and onboarding_role is not null
      and terms_accepted_at is not null
      and terms_version is not null
      and (onboarding_role <> 'lawyer' or full_name is not null)
    )
  );

comment on column public.users.onboarding_status is
  'Persistent Telegram onboarding state; completed requires language, role and terms.';
