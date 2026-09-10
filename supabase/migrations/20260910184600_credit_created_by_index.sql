begin;

create index credit_transactions_created_by_idx
  on public.credit_transactions (created_by)
  where created_by is not null;

commit;
