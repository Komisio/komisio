-- Pre-arrival evidence only. No custody, inventory or financial side effects.
create table public.seller_submissions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 previous_id uuid unique,
 description text not null check(length(trim(description)) between 1 and 2000),
 photos jsonb not null check(jsonb_typeof(photos)='array' and jsonb_array_length(photos) between 1 and 8),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,previous_id) references public.seller_submissions(tenant_id,id)
);
create table public.seller_submission_reviews (
 id uuid primary key,
 tenant_id uuid not null,
 submission_id uuid not null unique,
 decision text not null check(decision in ('invite','more_information','decline')),
 note text not null check(length(note)<=1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,submission_id) references public.seller_submissions(tenant_id,id)
);
create index seller_submissions_queue on public.seller_submissions(tenant_id,created_at desc,id);
create index seller_submissions_seller on public.seller_submissions(tenant_id,seller_id,created_at desc,id);
alter table public.seller_submissions enable row level security;
alter table public.seller_submission_reviews enable row level security;
revoke all on public.seller_submissions,public.seller_submission_reviews from public,anon,authenticated;
grant select on public.seller_submissions,public.seller_submission_reviews to authenticated;
create policy seller_submissions_staff_read on public.seller_submissions for select to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy seller_submission_reviews_staff_read on public.seller_submission_reviews for select to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create trigger seller_submissions_immutable before update or delete on public.seller_submissions
 for each row execute function komisio_private.preserve_payout_event();
create trigger seller_submission_reviews_immutable before update or delete on public.seller_submission_reviews
 for each row execute function komisio_private.preserve_payout_event();

-- Storage has a separate namespace from received goods. Sellers never access staff reception.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('seller-submission-photos','seller-submission-photos',false,1048576,array['image/jpeg']);
create function public.seller_submission_photo_access(p_name text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare parts text[]; t uuid; s uuid;
begin
 perform komisio_private.require_identity();
 parts:=string_to_array(p_name,'/');
 if array_length(parts,1)<>3 or parts[3] !~ '^[0-9a-f-]{36}\.jpg$' then return false; end if;
 t:=parts[1]::uuid; s:=parts[2]::uuid;
 if not p_write and coalesce(public.tenant_role(t),'') in ('owner','admin','staff','readonly') then return true; end if;
 perform komisio_private.require_seller(t,s);
 return true;
exception when others then return false;
end $$;
revoke all on function public.seller_submission_photo_access(text,boolean) from public,anon;
grant execute on function public.seller_submission_photo_access(text,boolean) to authenticated;
create policy seller_submission_photo_insert on storage.objects for insert to authenticated
 with check(bucket_id='seller-submission-photos' and public.seller_submission_photo_access(name,true));
create policy seller_submission_photo_read on storage.objects for select to authenticated
 using(bucket_id='seller-submission-photos' and public.seller_submission_photo_access(name,false));

create function public.submit_my_items(p_tenant uuid,p_id uuid,p_seller uuid,p_previous uuid,p_description text,p_photos jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_submissions; path text; d text:=trim(p_description);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or d is null or length(d) not between 1 and 2000 or p_photos is null or jsonb_typeof(p_photos)<>'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_photos) not between 1 and 8 or exists(select 1 from jsonb_array_elements(p_photos) x where jsonb_typeof(x)<>'string') then raise exception 'INVALID_INPUT'; end if;
 if (select count(distinct x) from jsonb_array_elements(p_photos) x)<>jsonb_array_length(p_photos) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_submissions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.previous_id is distinct from p_previous or prior.description is distinct from d or prior.photos is distinct from p_photos or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_previous is not null and (not exists(select 1 from public.seller_submissions s join public.seller_submission_reviews r on r.submission_id=s.id where s.id=p_previous and s.tenant_id=p_tenant and s.seller_id=p_seller and r.decision='more_information') or exists(select 1 from public.seller_submissions where previous_id=p_previous)) then raise exception 'SUBMISSION_CHANGED'; end if;
 for path in select jsonb_array_elements_text(p_photos) loop
  if path not like p_tenant::text||'/'||p_seller::text||'/%' or not public.seller_submission_photo_access(path,true)
   or not exists(select 1 from storage.objects where bucket_id='seller-submission-photos' and name=path) then raise exception 'PHOTO_NOT_FOUND'; end if;
 end loop;
 insert into public.seller_submissions(id,tenant_id,seller_id,previous_id,description,photos,created_by)
 values(p_id,p_tenant,p_seller,p_previous,d,p_photos,uid);
 perform komisio_private.record_access(p_tenant,'seller_submission.sent',p_id,'{}');
 return p_id;
end $$;

create function public.review_seller_submission(p_tenant uuid,p_id uuid,p_submission uuid,p_decision text,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.seller_submission_reviews; n text:=trim(coalesce(p_note,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_submission is null or p_decision is null or p_decision not in ('invite','more_information','decline') or length(n)>1000 or (p_decision='more_information' and n='') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_submission_reviews where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.submission_id is distinct from p_submission or prior.decision is distinct from p_decision or prior.note is distinct from n or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.seller_submissions where tenant_id=p_tenant and id=p_submission) then raise exception 'SUBMISSION_NOT_FOUND'; end if;
 if exists(select 1 from public.seller_submission_reviews where submission_id=p_submission) then raise exception 'SUBMISSION_CHANGED'; end if;
 insert into public.seller_submission_reviews(id,tenant_id,submission_id,decision,note,created_by) values(p_id,p_tenant,p_submission,p_decision,n,uid);
 perform komisio_private.record_access(p_tenant,'seller_submission.reviewed',p_id,jsonb_build_object('decision',p_decision));
 return p_id;
end $$;
create function public.my_item_submissions(p_tenant uuid,p_seller uuid,p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') into result from (
  select s.id,s.previous_id,s.description,s.photos,s.created_at,r.decision,r.note
  from public.seller_submissions s left join public.seller_submission_reviews r on r.submission_id=s.id
  where s.tenant_id=p_tenant and s.seller_id=p_seller and (p_before is null or s.created_at<p_before)
  order by s.created_at desc,s.id limit 50
 ) x;
 return result;
end $$;
revoke all on function public.submit_my_items(uuid,uuid,uuid,uuid,text,jsonb),public.review_seller_submission(uuid,uuid,uuid,text,text),public.my_item_submissions(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.submit_my_items(uuid,uuid,uuid,uuid,text,jsonb),public.review_seller_submission(uuid,uuid,uuid,text,text),public.my_item_submissions(uuid,uuid,timestamptz) to authenticated;
