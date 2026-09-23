begin;

create index lawyer_specializations_specialization_id_idx
  on public.lawyer_specializations (specialization_id, lawyer_id);
create index lawyer_verifications_reviewed_by_idx
  on public.lawyer_verifications (reviewed_by)
  where reviewed_by is not null;
create index admin_login_logs_admin_id_idx
  on public.admin_login_logs (admin_id)
  where admin_id is not null;

create policy lawyer_profiles_deny_client_access
  on public.lawyer_profiles for all to anon, authenticated
  using (false) with check (false);
create policy specializations_deny_client_access
  on public.specializations for all to anon, authenticated
  using (false) with check (false);
create policy lawyer_specializations_deny_client_access
  on public.lawyer_specializations for all to anon, authenticated
  using (false) with check (false);
create policy lawyer_verifications_deny_client_access
  on public.lawyer_verifications for all to anon, authenticated
  using (false) with check (false);
create policy verification_documents_deny_client_access
  on public.verification_documents for all to anon, authenticated
  using (false) with check (false);
create policy admin_accounts_deny_client_access
  on public.admin_accounts for all to anon, authenticated
  using (false) with check (false);
create policy admin_sessions_deny_client_access
  on public.admin_sessions for all to anon, authenticated
  using (false) with check (false);
create policy audit_logs_deny_client_access
  on public.audit_logs for all to anon, authenticated
  using (false) with check (false);
create policy admin_login_logs_deny_client_access
  on public.admin_login_logs for all to anon, authenticated
  using (false) with check (false);

commit;
