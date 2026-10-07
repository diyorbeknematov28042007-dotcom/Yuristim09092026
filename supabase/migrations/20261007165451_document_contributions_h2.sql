begin;
create table public.document_contributions (
 id uuid primary key default gen_random_uuid(),
 public_id text not null unique default ('DLC-' || replace(gen_random_uuid()::text,'-','')),
 user_id uuid not null references public.users(id) on delete restrict,
 document_type text not null check (document_type in ('nikoh-shartnomasi','davo-arizasi','ijara-shartnomasi','ishonchnoma','talabnoma')),
 original_filename text not null check (char_length(original_filename) between 1 and 200 and position('/' in original_filename)=0 and position(chr(92) in original_filename)=0 and original_filename !~ '[[:cntrl:]]'),
 mime_type text not null check (mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 file_size_bytes integer not null check (file_size_bytes between 1 and 5242880),
 storage_path text not null unique,
 status text not null default 'draft' check (status in ('draft','submitted','under_review','approved','rejected')),
 privacy_acknowledged boolean not null check (privacy_acknowledged),
 rights_confirmed boolean not null check (rights_confirmed),
 idempotency_key uuid not null,
 upload_fingerprint text not null check (upload_fingerprint ~ '^[a-f0-9]{64}$'),
 file_sha256 text check (file_sha256 ~ '^[a-f0-9]{64}$'),
 upload_expires_at timestamptz not null default (now()+interval '2 hours'),
 submitted_at timestamptz,
 reviewed_at timestamptz,
 reviewed_by uuid references public.admin_accounts(id) on delete restrict,
 rejection_reason text check (rejection_reason is null or char_length(btrim(rejection_reason)) between 3 and 1000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,idempotency_key),
 check (storage_path ~ ('^' || user_id::text || '/[a-f0-9-]{36}/source[.](pdf|docx)$')),
 check ((mime_type='application/pdf' and storage_path like '%/source.pdf' and lower(original_filename) like '%.pdf') or (mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document' and storage_path like '%/source.docx' and lower(original_filename) like '%.docx')),
 check ((status='draft' and submitted_at is null and file_sha256 is null) or (status<>'draft' and submitted_at is not null and file_sha256 is not null)),
 check ((status in ('approved','rejected') and reviewed_at is not null and reviewed_by is not null) or (status not in ('approved','rejected') and reviewed_at is null and reviewed_by is null)),
 check ((status='rejected' and rejection_reason is not null) or (status<>'rejected' and rejection_reason is null))
);
comment on table public.document_contributions is 'Private user source contributions. Approval is neither public publication nor canonical/legal verification. Custom API sessions enforce ownership; Supabase client roles have no access.';
create index document_contributions_owner_idx on public.document_contributions(user_id,submitted_at desc,id);
create index document_contributions_queue_idx on public.document_contributions(status,submitted_at desc) where status<>'draft';
create index document_contributions_hash_idx on public.document_contributions(file_sha256) where file_sha256 is not null;
create index document_contributions_reviewer_idx on public.document_contributions(reviewed_by) where reviewed_by is not null;
create index document_contributions_expiry_idx on public.document_contributions(upload_expires_at) where status='draft';
alter table public.document_contributions enable row level security;
alter table public.document_contributions force row level security;
revoke all on public.document_contributions from public,anon,authenticated;
grant all on public.document_contributions to service_role;
create policy document_contributions_deny_clients on public.document_contributions for all to anon,authenticated using(false) with check(false);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('document-contributions','document-contributions',false,5242880,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
-- Restrictive fence remains effective even if another bucket's permissive policy is broad.
create policy document_contributions_private_objects on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'document-contributions') with check(bucket_id<>'document-contributions');
create function app_private.protect_document_contribution() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status in ('approved','rejected') then raise exception using errcode='40001',message='review is final'; end if;
 if row(new.id,new.public_id,new.user_id,new.document_type,new.original_filename,new.mime_type,new.file_size_bytes,new.storage_path,new.privacy_acknowledged,new.rights_confirmed,new.idempotency_key,new.upload_fingerprint,new.upload_expires_at,new.created_at) is distinct from row(old.id,old.public_id,old.user_id,old.document_type,old.original_filename,old.mime_type,old.file_size_bytes,old.storage_path,old.privacy_acknowledged,old.rights_confirmed,old.idempotency_key,old.upload_fingerprint,old.upload_expires_at,old.created_at) then raise exception using errcode='23514',message='source metadata is immutable'; end if;
 if old.status<>'draft' and row(new.file_sha256,new.submitted_at) is distinct from row(old.file_sha256,old.submitted_at) then raise exception using errcode='23514',message='source hash is immutable'; end if;
 if new.status<>old.status and not ((old.status='draft' and new.status='submitted') or (old.status='submitted' and new.status in ('under_review','approved','rejected')) or (old.status='under_review' and new.status in ('approved','rejected'))) then raise exception using errcode='40001',message='invalid contribution transition'; end if;
 return new;
end $$;
revoke all on function app_private.protect_document_contribution() from public,anon,authenticated;
create trigger document_contributions_guard before update on public.document_contributions for each row execute function app_private.protect_document_contribution();
create trigger document_contributions_updated_at before update on public.document_contributions for each row execute function app_private.set_updated_at();
create function public.submit_document_contribution(p_id uuid,p_user_id uuid,p_file_sha256 text) returns setof public.document_contributions language plpgsql security invoker set search_path='' as $$
declare v public.document_contributions; m jsonb;
begin
 select * into v from public.document_contributions where id=p_id and user_id=p_user_id for update;
 if not found then raise exception using errcode='P0002',message='contribution not found'; end if;
 if v.status<>'draft' then return next v; return; end if;
 if v.upload_expires_at<=now() then raise exception using errcode='40001',message='upload expired'; end if;
 select metadata into m from storage.objects where bucket_id='document-contributions' and name=v.storage_path;
 if m is null or (m->>'size')::bigint is distinct from v.file_size_bytes::bigint or m->>'mimetype' is distinct from v.mime_type then raise exception using errcode='23514',message='stored file metadata mismatch'; end if;
 update public.document_contributions set status='submitted',file_sha256=p_file_sha256,submitted_at=now() where id=v.id returning * into v;
 return next v;
end $$;
create function public.review_document_contribution(p_id uuid,p_admin_id uuid,p_decision text,p_reason text default null) returns setof public.document_contributions language plpgsql security invoker set search_path='' as $$
declare v public.document_contributions; previous text;
begin
 if not exists(select 1 from public.admin_accounts where id=p_admin_id and role='admin' and status='active') then raise exception using errcode='42501',message='admin required'; end if;
 if p_decision not in ('under_review','approved','rejected') or p_decision is null then raise exception using errcode='22023',message='invalid decision'; end if;
 if p_decision='rejected' and (p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000) then raise exception using errcode='22023',message='reason required'; end if;
 select * into v from public.document_contributions where id=p_id for update;
 if not found then raise exception using errcode='P0002',message='contribution not found'; end if;
 if v.status not in ('submitted','under_review') or (p_decision='under_review' and v.status<>'submitted') then raise exception using errcode='40001',message='invalid review transition'; end if;
 previous:=v.status;
 update public.document_contributions set status=p_decision, reviewed_at=case when p_decision='under_review' then null else now() end,reviewed_by=case when p_decision='under_review' then null else p_admin_id end,rejection_reason=case when p_decision='rejected' then btrim(p_reason) else null end where id=v.id returning * into v;
 insert into public.audit_logs(actor_type,actor_id,action,entity_type,entity_id,metadata) values('admin',p_admin_id,'document_contribution.'||p_decision,'document_contribution',p_id,jsonb_build_object('previousStatus',previous,'status',p_decision));
 return next v;
end $$;
revoke all on function public.submit_document_contribution(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.review_document_contribution(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_document_contribution(uuid,uuid,text) to service_role;
grant execute on function public.review_document_contribution(uuid,uuid,text,text) to service_role;
commit;
