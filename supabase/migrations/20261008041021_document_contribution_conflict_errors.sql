begin;
-- Business conflicts are not serialization failures. PT409 returns a bounded HTTP conflict
-- rather than inviting database/proxy serialization retries for immutable final decisions.
create or replace function app_private.protect_document_contribution() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status in ('approved','rejected') then raise exception using errcode='PT409',message='review is final'; end if;
 if row(new.id,new.public_id,new.user_id,new.document_type,new.original_filename,new.mime_type,new.file_size_bytes,new.storage_path,new.privacy_acknowledged,new.rights_confirmed,new.idempotency_key,new.upload_fingerprint,new.upload_expires_at,new.created_at) is distinct from row(old.id,old.public_id,old.user_id,old.document_type,old.original_filename,old.mime_type,old.file_size_bytes,old.storage_path,old.privacy_acknowledged,old.rights_confirmed,old.idempotency_key,old.upload_fingerprint,old.upload_expires_at,old.created_at) then raise exception using errcode='23514',message='source metadata is immutable'; end if;
 if old.status<>'draft' and row(new.file_sha256,new.submitted_at) is distinct from row(old.file_sha256,old.submitted_at) then raise exception using errcode='23514',message='source hash is immutable'; end if;
 if new.status<>old.status and not ((old.status='draft' and new.status='submitted') or (old.status='submitted' and new.status in ('under_review','approved','rejected')) or (old.status='under_review' and new.status in ('approved','rejected'))) then raise exception using errcode='PT409',message='invalid contribution transition'; end if;
 return new;
end $$;
create or replace function public.submit_document_contribution(p_id uuid,p_user_id uuid,p_file_sha256 text) returns setof public.document_contributions language plpgsql security invoker set search_path='' as $$
declare v public.document_contributions; m jsonb;
begin
 select * into v from public.document_contributions where id=p_id and user_id=p_user_id for update;
 if not found then raise exception using errcode='P0002',message='contribution not found'; end if;
 if v.status<>'draft' then return next v; return; end if;
 if v.upload_expires_at<=now() then raise exception using errcode='PT409',message='upload expired'; end if;
 select metadata into m from storage.objects where bucket_id='document-contributions' and name=v.storage_path;
 if m is null or (m->>'size')::bigint is distinct from v.file_size_bytes::bigint or m->>'mimetype' is distinct from v.mime_type then raise exception using errcode='23514',message='stored file metadata mismatch'; end if;
 update public.document_contributions set status='submitted',file_sha256=p_file_sha256,submitted_at=now() where id=v.id returning * into v;
 return next v;
end $$;
create or replace function public.review_document_contribution(p_id uuid,p_admin_id uuid,p_decision text,p_reason text default null) returns setof public.document_contributions language plpgsql security invoker set search_path='' as $$
declare v public.document_contributions; previous text;
begin
 if not exists(select 1 from public.admin_accounts where id=p_admin_id and role='admin' and status='active') then raise exception using errcode='42501',message='admin required'; end if;
 if p_decision not in ('under_review','approved','rejected') or p_decision is null then raise exception using errcode='22023',message='invalid decision'; end if;
 if p_decision='rejected' and (p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000) then raise exception using errcode='22023',message='reason required'; end if;
 select * into v from public.document_contributions where id=p_id for update;
 if not found then raise exception using errcode='P0002',message='contribution not found'; end if;
 if v.status not in ('submitted','under_review') or (p_decision='under_review' and v.status<>'submitted') then raise exception using errcode='PT409',message='invalid review transition'; end if;
 previous:=v.status;
 update public.document_contributions set status=p_decision, reviewed_at=case when p_decision='under_review' then null else now() end,reviewed_by=case when p_decision='under_review' then null else p_admin_id end,rejection_reason=case when p_decision='rejected' then btrim(p_reason) else null end where id=v.id returning * into v;
 insert into public.audit_logs(actor_type,actor_id,action,entity_type,entity_id,metadata) values('admin',p_admin_id,'document_contribution.'||p_decision,'document_contribution',p_id,jsonb_build_object('previousStatus',previous,'status',p_decision));
 return next v;
end $$;
commit;
