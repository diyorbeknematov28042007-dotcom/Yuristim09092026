begin;

select plan(27);

select has_table('public', 'lawyer_profiles', 'lawyer_profiles exists');
select has_table('public', 'specializations', 'specializations exists');
select has_table('public', 'lawyer_specializations', 'lawyer_specializations exists');
select has_table('public', 'lawyer_verifications', 'lawyer_verifications exists');
select has_table('public', 'verification_documents', 'verification_documents exists');
select has_table('public', 'admin_accounts', 'admin_accounts exists');
select has_table('public', 'admin_sessions', 'admin_sessions exists');
select has_table('public', 'audit_logs', 'audit_logs exists');
select has_table('public', 'admin_login_logs', 'admin_login_logs exists');

select col_is_unique('public', 'lawyer_profiles', 'user_id', 'one lawyer profile per user');
select col_is_unique('public', 'lawyer_profiles', 'public_slug', 'public slug is unique');
select col_is_pk('public', 'lawyer_specializations', array['lawyer_id', 'specialization_id'], 'specialization pair is unique');
select col_is_unique('public', 'admin_sessions', 'token_hash', 'admin session hash is unique');

select has_check('public', 'lawyer_profiles', 'lawyer_profiles_verification_status_check', 'profile verification status is constrained');
select has_check('public', 'lawyer_verifications', 'lawyer_verifications_status_check', 'request status is constrained');
select has_check('public', 'lawyer_verifications', 'rejected_verification_has_reason', 'rejected request requires a reason');
select has_check('public', 'verification_documents', 'verification_documents_size_bytes_check', 'files have a five-megabyte bound');

select is((select count(*)::integer from public.specializations where active), 12, 'MVP specializations are seeded');
select is((select public from storage.buckets where id = 'lawyer-verification'), false, 'verification bucket is private');
select is((select public from storage.buckets where id = 'profile-images'), false, 'profile image bucket is private');

select is((select relrowsecurity from pg_class where oid = 'public.lawyer_profiles'::regclass), true, 'lawyer profile RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.lawyer_profiles'::regclass), true, 'lawyer profile RLS forced');
select is((select relrowsecurity from pg_class where oid = 'public.lawyer_verifications'::regclass), true, 'verification RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.admin_accounts'::regclass), true, 'admin account RLS forced');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and policyname like '%_deny_client_access'), 9, 'explicit client deny policies exist');
select ok(not has_function_privilege('anon', 'public.review_lawyer_verification(uuid,uuid,text,text)', 'EXECUTE'), 'anon cannot review verifications');
select ok(has_function_privilege('service_role', 'public.review_lawyer_verification(uuid,uuid,text,text)', 'EXECUTE'), 'service role can review verifications');

select * from finish();
rollback;
