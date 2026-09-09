create policy users_deny_direct_client_access
on public.users
for all
to anon, authenticated
using (false)
with check (false);

create policy auth_sessions_deny_direct_client_access
on public.auth_sessions
for all
to anon, authenticated
using (false)
with check (false);

create policy auth_login_requests_deny_direct_client_access
on public.auth_login_requests
for all
to anon, authenticated
using (false)
with check (false);

create policy user_tags_deny_direct_client_access
on public.user_tags
for all
to anon, authenticated
using (false)
with check (false);
