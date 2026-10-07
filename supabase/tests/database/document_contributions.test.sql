begin;
select plan(34);
select has_table('public','document_contributions','private contributions table exists');
select is((select relrowsecurity from pg_class where oid='public.document_contributions'::regclass),true,'RLS enabled');
select is((select relforcerowsecurity from pg_class where oid='public.document_contributions'::regclass),true,'RLS forced');
select ok(not has_table_privilege('anon','public.document_contributions','SELECT'),'public denied');
select ok(not has_table_privilege('authenticated','public.document_contributions','SELECT'),'opaque API sessions cannot bypass API authorization with client DB reads');
select ok(not has_table_privilege('authenticated','public.document_contributions','INSERT'),'client direct insert denied');
select ok(has_table_privilege('service_role','public.document_contributions','SELECT'),'server repository allowed');
select ok(not has_function_privilege('anon','public.submit_document_contribution(uuid,uuid,text)','EXECUTE'),'public cannot finalize');
select ok(not has_function_privilege('authenticated','public.review_document_contribution(uuid,uuid,text,text)','EXECUTE'),'client cannot moderate');
select is((select public from storage.buckets where id='document-contributions'),false,'private bucket');
select is((select file_size_limit from storage.buckets where id='document-contributions'),5242880::bigint,'bucket 5 MB bound');
select ok((select allowed_mime_types @> array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'] from storage.buckets where id='document-contributions'),'PDF/DOCX enabled');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='document_contributions_private_objects' and permissive='RESTRICTIVE'),'storage clients denied even if other bucket policies are broad');
insert into public.users (id,telegram_user_id,duid) values
 ('b3cfa1a0-02a1-4b9f-9101-000000000001',990000000001,'yr_h2testowner000001'),
 ('b3cfa1a0-02a1-4b9f-9101-000000000002',990000000002,'yr_h2testother000002');
insert into public.admin_accounts(id,username,password_hash,role) values
 ('b3cfa1a0-02a1-4b9f-9101-000000000003','h2_pgtap_admin','synthetic-only','admin'),
 ('b3cfa1a0-02a1-4b9f-9101-000000000004','h2_pgtap_support','synthetic-only','support');
insert into public.document_contributions(id,user_id,document_type,original_filename,mime_type,file_size_bytes,storage_path,privacy_acknowledged,rights_confirmed,idempotency_key,upload_fingerprint) values
 ('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000001','ishonchnoma','synthetic.pdf','application/pdf',32,'b3cfa1a0-02a1-4b9f-9101-000000000001/b3cfa1a0-02a1-4b9f-9101-000000000010/source.pdf',true,true,'b3cfa1a0-02a1-4b9f-9101-000000000020',repeat('a',64)),
 ('b3cfa1a0-02a1-4b9f-9101-000000000011','b3cfa1a0-02a1-4b9f-9101-000000000001','ishonchnoma','synthetic.pdf','application/pdf',32,'b3cfa1a0-02a1-4b9f-9101-000000000001/b3cfa1a0-02a1-4b9f-9101-000000000011/source.pdf',true,true,'b3cfa1a0-02a1-4b9f-9101-000000000021',repeat('a',64));
select is((select status from public.document_contributions where id='b3cfa1a0-02a1-4b9f-9101-000000000010'),'draft','no fake submission before bytes');
select throws_ok($$select public.submit_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000002',repeat('b',64))$$,'P0002','contribution not found','other owner cannot finalize');
select throws_ok($$select public.submit_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000001',repeat('b',64))$$,'23514','stored file metadata mismatch','storage must exist');
insert into storage.objects(bucket_id,name,metadata) select 'document-contributions',storage_path,'{"size":32,"mimetype":"application/pdf"}'::jsonb from public.document_contributions;
select lives_ok($$select public.submit_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000001',repeat('b',64))$$,'authenticated server can submit valid stored source');
select is((select status from public.document_contributions where id='b3cfa1a0-02a1-4b9f-9101-000000000010'),'submitted','submitted only after storage');
select lives_ok($$select public.submit_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000001',repeat('b',64))$$,'submit idempotent');
select throws_ok($$select public.review_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000004','approved',null)$$,'42501','admin required','support forbidden');
select throws_ok($$select public.review_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000003','rejected',null)$$,'22023','reason required','reject requires reason');
select lives_ok($$select public.review_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000003','under_review',null)$$,'review start works');
select lives_ok($$select public.review_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000003','approved',null)$$,'approve works');
select is((select status from public.document_contributions where id='b3cfa1a0-02a1-4b9f-9101-000000000010'),'approved','approved stays a contribution');
select is((select count(*)::integer from public.audit_logs where entity_id='b3cfa1a0-02a1-4b9f-9101-000000000010'),2,'review start and approve audited');
select throws_ok($$select public.review_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000003','rejected','Synthetic reason')$$,'40001','invalid review transition','final decision cannot be overwritten');
select throws_ok($$update public.document_contributions set status='draft' where id='b3cfa1a0-02a1-4b9f-9101-000000000010'$$,'40001','review is final','invalid transition blocked by table guard');
select lives_ok($$select public.submit_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000011','b3cfa1a0-02a1-4b9f-9101-000000000001',repeat('b',64))$$,'same exact hash is a signal, not automatic rejection');
select lives_ok($$select public.review_document_contribution('b3cfa1a0-02a1-4b9f-9101-000000000011','b3cfa1a0-02a1-4b9f-9101-000000000003','rejected','Synthetic test reason')$$,'reject works');
select is((select rejection_reason from public.document_contributions where id='b3cfa1a0-02a1-4b9f-9101-000000000011'),'Synthetic test reason','reason stored');
select is((select count(*)::integer from public.audit_logs where entity_id='b3cfa1a0-02a1-4b9f-9101-000000000011' and action='document_contribution.rejected'),1,'reject audited');
select ok(not exists(select 1 from public.audit_logs where entity_id in ('b3cfa1a0-02a1-4b9f-9101-000000000010','b3cfa1a0-02a1-4b9f-9101-000000000011') and (metadata ? 'filename' or metadata ? 'content' or metadata ? 'storagePath')),'audit omits source content');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='document_contributions' and column_name in ('public_url','canonical_template','credit_reward')),'no public URL, automatic canonical template or reward');
select is((select count(*)::integer from public.document_contributions where user_id='b3cfa1a0-02a1-4b9f-9101-000000000002'),0,'owner-scoped DB query has no other user sources');
select * from finish();
rollback;
