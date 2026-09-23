begin;

select plan(36);

select has_table('public', 'marketplace_posts', 'marketplace posts exist');
select has_table('public', 'marketplace_acceptances', 'marketplace acceptances exist');
select has_table('public', 'marketplace_reviews', 'marketplace reviews exist');
select col_is_unique('public', 'marketplace_posts', 'public_id', 'post public identifier is unique');
select col_is_unique('public', 'marketplace_acceptances', 'public_id', 'acceptance public identifier is unique');
select col_is_unique('public', 'marketplace_reviews', 'marketplace_post_id', 'one review per post');
select is((select relrowsecurity from pg_class where oid = 'public.marketplace_posts'::regclass), true, 'post RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.marketplace_posts'::regclass), true, 'post RLS forced');
select policies_are('public', 'marketplace_posts', array['marketplace_posts_deny_client_access'], 'posts explicitly deny clients');
select policies_are('public', 'marketplace_acceptances', array['marketplace_acceptances_deny_client_access'], 'acceptances explicitly deny clients');
select policies_are('public', 'marketplace_reviews', array['marketplace_reviews_deny_client_access'], 'reviews explicitly deny clients');
select ok(not has_function_privilege('anon', 'public.accept_marketplace_post(uuid,text,text,timestamptz)', 'EXECUTE'), 'anon cannot accept listings');
select ok(has_function_privilege('service_role', 'public.accept_marketplace_post(uuid,text,text,timestamptz)', 'EXECUTE'), 'service role can accept listings');

insert into public.users (
  id, telegram_user_id, telegram_first_name, duid, onboarding_role, active_mode, status, created_at
)
select
  ('60000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  906000000000 + n,
  case when n = 1 then 'Owner' else 'Lawyer ' || n end,
  'yr_phase6user' || lpad(n::text, 6, '0'),
  case when n = 1 then 'user' else 'lawyer' end,
  case when n = 1 then 'user' else 'lawyer' end,
  'active', now()
from generate_series(1, 8) n;

insert into public.lawyer_profiles (id, user_id, verification_status, public_slug, verified_at)
select
  ('61000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('60000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 8 then 'unverified' else 'approved' end,
  'phase6-lawyer-' || n,
  case when n = 8 then null else now() end
from generate_series(2, 8) n;

do $$
declare n integer;
begin
  for n in 2..8 loop
    perform public.grant_accepts(
      ('61000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
      2, 'bonus', 'phase6-seed', null, now()
    );
  end loop;
end;
$$;
select pass('lawyers receive isolated accept balances');

create temporary table phase6_post as
select * from public.create_marketplace_post(
  '60000000-0000-4000-8000-000000000001',
  'mp_1234567890abcdef12345678', 'labor',
  'Mehnat shartnomasi bo‘yicha yetarlicha uzun muammo tavsifi.',
  'Toshkent', 'Qo‘shimcha holatlar mavjud', 'uz', 'phase6-create-0001',
  now() + interval '14 days', now()
);
select is((select status from phase6_post), 'open', 'created post is open');
select matches((select public_id from phase6_post), '^mp_[A-Za-z0-9_-]{20,48}$', 'post identifier is opaque');
select is((select count(*)::integer from public.marketplace_posts where user_id = '60000000-0000-4000-8000-000000000001'), 1, 'one post exists');
select lives_ok($$select public.create_marketplace_post(
  '60000000-0000-4000-8000-000000000001', 'mp_aaaaaaaaaaaaaaaaaaaaaaaa', 'labor',
  'Mehnat shartnomasi bo‘yicha yetarlicha uzun muammo tavsifi.', 'Toshkent', null,
  'uz', 'phase6-create-0001', now() + interval '14 days', now()
)$$, 'duplicate post submission is idempotent');
select is((select count(*)::integer from public.marketplace_posts where user_id = '60000000-0000-4000-8000-000000000001'), 1, 'duplicate submission creates no second post');

select is(
  (public.accept_marketplace_post(
    '60000000-0000-4000-8000-000000000001', (select public_id from phase6_post),
    'ma_00000000000000000001', now()
  )->>'code'),
  'LAWYER_ROLE_REQUIRED', 'owner cannot accept own post'
);
select is(
  (public.accept_marketplace_post(
    '60000000-0000-4000-8000-000000000008', (select public_id from phase6_post),
    'ma_00000000000000000008', now()
  )->>'code'),
  'LAWYER_NOT_VERIFIED', 'unverified lawyer is rejected'
);

select public.accept_marketplace_post(
  '60000000-0000-4000-8000-000000000002', (select public_id from phase6_post),
  'ma_00000000000000000002', now()
);
select is((select count(*)::integer from public.marketplace_acceptances), 1, 'one acceptance is created');
select is((select count(*)::integer from public.marketplace_accept_transactions where type = 'usage' and reference_id like 'marketplace:%'), 1, 'exactly one debit is appended');
select is(
  (public.accept_marketplace_post(
    '60000000-0000-4000-8000-000000000002', (select public_id from phase6_post),
    'ma_99999999999999999999', now()
  )->>'duplicate')::boolean,
  true, 'duplicate accept is idempotent'
);
select is((select count(*)::integer from public.marketplace_accept_transactions where type = 'usage' and reference_id like 'marketplace:%'), 1, 'duplicate accept does not double debit');

do $$
declare n integer;
begin
  for n in 3..6 loop
    perform public.accept_marketplace_post(
      ('60000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
      (select public_id from phase6_post),
      'ma_' || lpad(n::text, 20, '0'), now()
    );
  end loop;
end;
$$;
select is((select count(*)::integer from public.marketplace_acceptances), 5, 'maximum five acceptances are stored');
select is(
  (public.accept_marketplace_post(
    '60000000-0000-4000-8000-000000000007', (select public_id from phase6_post),
    'ma_00000000000000000007', now()
  )->>'code'),
  'MARKETPLACE_CAPACITY_FULL', 'sixth approved lawyer is blocked by capacity'
);
select is((select count(*)::integer from public.marketplace_accept_transactions where type = 'usage' and lawyer_id = '61000000-0000-4000-8000-000000000007'), 0, 'failed sixth acceptance has no debit');

select is(
  (public.select_marketplace_lawyer(
    '60000000-0000-4000-8000-000000000001', (select public_id from phase6_post),
    'ma_00000000000000000002', now()
  )->>'ok')::boolean,
  true, 'owner selects accepted lawyer'
);
select is((select status from public.marketplace_posts where id = (select id from phase6_post)), 'selected', 'selection closes post');
select is(
  (public.accept_marketplace_post(
    '60000000-0000-4000-8000-000000000008', (select public_id from phase6_post),
    'ma_00000000000000000008', now()
  )->>'code'),
  'MARKETPLACE_POST_CLOSED', 'selected post blocks new accepts'
);
select is(
  (public.submit_marketplace_review(
    '60000000-0000-4000-8000-000000000001', (select public_id from phase6_post),
    5::smallint, 'Ajoyib xizmat', now()
  )->>'ok')::boolean,
  true, 'owner reviews selected lawyer'
);
select is((select count(*)::integer from public.marketplace_reviews), 1, 'one review is stored');
select is(
  (public.submit_marketplace_review(
    '60000000-0000-4000-8000-000000000001', (select public_id from phase6_post),
    4::smallint, 'Takroriy baho', now()
  )->>'code'),
  'REVIEW_ALREADY_EXISTS', 'duplicate review is rejected'
);
select is((select count(*)::integer from public.marketplace_reviews), 1, 'duplicate review creates no second row');
select is((select rating_count from public.lawyer_profiles where id = '61000000-0000-4000-8000-000000000002'), 1, 'public rating aggregate is updated');

select * from finish();
rollback;
