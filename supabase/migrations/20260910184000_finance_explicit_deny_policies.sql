begin;

create policy credit_transactions_deny_client_access
  on public.credit_transactions for all to anon, authenticated using (false) with check (false);
create policy credit_products_deny_client_access
  on public.credit_products for all to anon, authenticated using (false) with check (false);
create policy marketplace_accept_transactions_deny_client_access
  on public.marketplace_accept_transactions for all to anon, authenticated using (false) with check (false);
create policy marketplace_accept_products_deny_client_access
  on public.marketplace_accept_products for all to anon, authenticated using (false) with check (false);
create policy payments_deny_client_access
  on public.payments for all to anon, authenticated using (false) with check (false);

commit;
