begin;

select plan(50);

select has_table('public', 'credit_transactions', 'credit transaction ledger exists');
select has_table('public', 'credit_products', 'credit products exist');
select has_table('public', 'marketplace_accept_transactions', 'accept transaction ledger exists');
select has_table('public', 'marketplace_accept_products', 'accept products exist');
select has_table('public', 'payments', 'payments exist');
select col_is_unique('public', 'payments', 'idempotency_key', 'checkout idempotency key is unique');
select has_check('public', 'credit_transactions', 'credit_bucket_expiry_matches', 'bucket expiry is constrained');
select has_check('public', 'credit_products', 'active_credit_product_is_sellable', 'active credit products are sellable');
select has_check('public', 'payments', 'payment_terminal_timestamps_match', 'payment terminal timestamps are constrained');
select is((select count(*)::integer from public.credit_products), 4, 'four draft credit products are seeded');
select is((select count(*)::integer from public.credit_products where active), 0, 'unpriced credit products are not active');
select is((select price from public.marketplace_accept_products where code = 'single_accept'), 9900.00::numeric, 'single accept costs 9900 UZS');
select is((select active from public.marketplace_accept_products where code = 'single_accept'), true, 'single accept is active');

select is((select relrowsecurity from pg_class where oid = 'public.credit_transactions'::regclass), true, 'credit ledger RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.credit_products'::regclass), true, 'credit product RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.marketplace_accept_transactions'::regclass), true, 'accept ledger RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.marketplace_accept_products'::regclass), true, 'accept product RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.payments'::regclass), true, 'payment RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.credit_transactions'::regclass), true, 'credit ledger RLS forced');
select is((select relforcerowsecurity from pg_class where oid = 'public.credit_products'::regclass), true, 'credit product RLS forced');
select is((select relforcerowsecurity from pg_class where oid = 'public.marketplace_accept_transactions'::regclass), true, 'accept ledger RLS forced');
select is((select relforcerowsecurity from pg_class where oid = 'public.marketplace_accept_products'::regclass), true, 'accept product RLS forced');
select is((select relforcerowsecurity from pg_class where oid = 'public.payments'::regclass), true, 'payment RLS forced');
select policies_are('public', 'credit_transactions', array['credit_transactions_deny_client_access'], 'credit ledger explicitly denies clients');
select policies_are('public', 'credit_products', array['credit_products_deny_client_access'], 'credit products explicitly deny clients');
select policies_are('public', 'marketplace_accept_transactions', array['marketplace_accept_transactions_deny_client_access'], 'accept ledger explicitly denies clients');
select policies_are('public', 'marketplace_accept_products', array['marketplace_accept_products_deny_client_access'], 'accept products explicitly deny clients');
select policies_are('public', 'payments', array['payments_deny_client_access'], 'payments explicitly deny clients');
select ok(not has_function_privilege('anon', 'public.debit_credits(uuid,numeric,text,text,text,text,timestamptz)', 'EXECUTE'), 'anon cannot debit credits');
select ok(has_function_privilege('service_role', 'public.process_payment_webhook(uuid,text,text,text,timestamptz)', 'EXECUTE'), 'service role can process verified webhooks');

insert into public.users (
  id, telegram_user_id, telegram_first_name, duid, created_at
) values (
  '50000000-0000-4000-8000-000000000001', 905000000001, 'Phase 5',
  'yr_phase5test000001', '2026-09-09 12:00:00+00'
);

select is((select count(*)::integer from public.credit_transactions where user_id = '50000000-0000-4000-8000-000000000001' and type = 'welcome_bonus'), 1, 'new user receives one welcome transaction');
select is((select amount from public.credit_transactions where user_id = '50000000-0000-4000-8000-000000000001' and type = 'welcome_bonus'), 50.000::numeric, 'welcome transaction grants 50');
select is((select total from public.credit_balance('50000000-0000-4000-8000-000000000001', '2026-09-09 12:00:00+00')), 50.000::numeric, 'welcome balance is 50');

do $$ begin
  perform public.grant_welcome_credit('50000000-0000-4000-8000-000000000001', '2026-09-09 12:00:00+00');
end $$;
select is((select count(*)::integer from public.credit_transactions where user_id = '50000000-0000-4000-8000-000000000001' and type = 'welcome_bonus'), 1, 'welcome retry is a no-op');

do $$ begin
  perform public.grant_weekly_credits('2026-09-09 12:00:00+00');
  perform public.grant_weekly_credits('2026-09-09 12:00:00+00');
end $$;
select is((select count(*)::integer from public.credit_transactions where user_id = '50000000-0000-4000-8000-000000000001' and type = 'weekly_bonus'), 1, 'weekly grant is idempotent per Tashkent week');
select is((select amount from public.credit_transactions where user_id = '50000000-0000-4000-8000-000000000001' and type = 'weekly_bonus'), 12.000::numeric, 'weekly grant adds 12');

do $$ begin
  perform public.grant_credit(
    '50000000-0000-4000-8000-000000000001', 'student_bonus', 'bonus', 3,
    'test', 'expiring-bonus', '2026-09-12 00:00:00+00', 'Expiring bonus', null,
    '2026-09-09 12:00:00+00'
  );
  perform public.grant_credit(
    '50000000-0000-4000-8000-000000000001', 'purchase', 'paid', 20,
    'sandbox', 'paid-credit', null, 'Paid credit', null, '2026-09-09 12:00:00+00'
  );
  perform public.debit_credits(
    '50000000-0000-4000-8000-000000000001', 66.5, 'ai_usage',
    'test', 'usage-1', 'Fractional debit', '2026-09-09 12:00:00+00'
  );
end $$;
select is((select sum(amount) from public.credit_transactions where reference_id = 'usage-1' and bucket_type = 'weekly'), -12.000::numeric, 'weekly bucket is debited first');
select is((select sum(amount) from public.credit_transactions where reference_id = 'usage-1' and bucket_type = 'bonus' and expires_at is not null), -3.000::numeric, 'expiring bonus is debited second');
select is((select sum(amount) from public.credit_transactions where reference_id = 'usage-1' and bucket_type = 'bonus' and expires_at is null), -50.000::numeric, 'non-expiring bonus is debited before paid');
select is((select sum(amount) from public.credit_transactions where reference_id = 'usage-1' and bucket_type = 'paid'), -1.500::numeric, 'paid bucket is debited last and supports fractions');
select is((select total from public.credit_balance('50000000-0000-4000-8000-000000000001', '2026-09-09 12:00:00+00')), 18.500::numeric, 'fractional debit preserves exact balance');

do $$ begin
  perform public.grant_credit(
    '50000000-0000-4000-8000-000000000001', 'refund', 'bonus', 5,
    'support', 'refund-1', null, 'Refund', null, '2026-09-09 12:00:00+00'
  );
end $$;
select is((select total from public.credit_balance('50000000-0000-4000-8000-000000000001', '2026-09-09 12:00:00+00')), 23.500::numeric, 'refund appends value to the ledger');
select throws_ok(
  $$update public.credit_transactions set reason = 'mutated' where reference_id = 'refund-1'$$,
  '22023', 'financial ledger records are immutable', 'credit ledger cannot be updated'
);

insert into public.lawyer_profiles (
  id, user_id, verification_status, public_slug, verified_at
) values (
  '51000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'approved', 'yr_phase5test000001',
  '2026-09-09 12:00:00+00'
);
do $$ begin
  perform public.grant_accepts(
    '51000000-0000-4000-8000-000000000001', 5, 'purchase', 'accept-package',
    '2026-09-20 00:00:00+00', '2026-09-09 12:00:00+00'
  );
  perform public.debit_accept(
    '51000000-0000-4000-8000-000000000001', 'listing-1', '2026-09-09 12:00:00+00'
  );
end $$;
select is((select balance from public.accept_balance('51000000-0000-4000-8000-000000000001', '2026-09-09 12:00:00+00')), 4, 'accept purchase and debit update accept balance');
select is((select total from public.credit_balance('50000000-0000-4000-8000-000000000001', '2026-09-09 12:00:00+00')), 23.500::numeric, 'accept units stay separate from AI credits');
select throws_ok(
  $$update public.marketplace_accept_transactions set amount = 9 where reference_id = 'accept-package'$$,
  '22023', 'financial ledger records are immutable', 'accept ledger cannot be updated'
);

insert into public.payments (
  id, user_id, provider, type, amount_money, status, product_id, product_code,
  product_units, idempotency_key
) values (
  '52000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'sandbox', 'credits', 10000,
  'pending', '53000000-0000-4000-8000-000000000001', 'credits_test', 100,
  'phase5-payment-test'
);
create temporary table phase5_webhook_results (
  payment_id uuid, payment_status text, processed boolean
) on commit drop;
insert into phase5_webhook_results
select * from public.process_payment_webhook(
  '52000000-0000-4000-8000-000000000001', 'sandbox', 'provider-phase5-1', 'paid',
  '2026-09-09 12:00:00+00'
);
insert into phase5_webhook_results
select * from public.process_payment_webhook(
  '52000000-0000-4000-8000-000000000001', 'sandbox', 'provider-phase5-1', 'paid',
  '2026-09-09 12:00:00+00'
);
select is((select count(*)::integer from phase5_webhook_results where processed), 1, 'first webhook is processed once');
select is((select count(*)::integer from phase5_webhook_results where not processed), 1, 'duplicate webhook is a no-op');
select is((select count(*)::integer from public.credit_transactions where type = 'purchase' and reference_id = '52000000-0000-4000-8000-000000000001'), 1, 'duplicate webhook grants exactly one paid ledger entry');
select is((select status from public.payments where id = '52000000-0000-4000-8000-000000000001'), 'paid', 'verified webhook marks payment paid');

select * from finish();
rollback;
