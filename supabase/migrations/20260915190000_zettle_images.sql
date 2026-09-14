create table public.zettle_image_intents (
 id uuid primary key, tenant_id uuid not null, item_id uuid not null,
 export_id uuid not null, merchant_id uuid not null, product_id uuid not null,
 source_reference text not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id), unique(tenant_id,item_id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 foreign key(tenant_id,export_id) references public.zettle_product_exports(tenant_id,id),
 foreign key(tenant_id,merchant_id) references public.zettle_pull_connections(tenant_id,merchant_id)
);
create table public.zettle_image_uploads (
 intent_id uuid primary key, tenant_id uuid not null, image_url text not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,intent_id) references public.zettle_image_intents(tenant_id,id),
 check(image_url ~ '^https://image[.]izettle[.]com/(product|v2/images/product)/[A-Za-z0-9_-]+([.](jpg|jpeg|png))?$' and length(image_url)<=512)
);
create table public.zettle_image_outcomes (
 intent_id uuid primary key, tenant_id uuid not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,intent_id) references public.zettle_image_intents(tenant_id,id),
 foreign key(intent_id) references public.zettle_image_uploads(intent_id)
);
do $$ declare table_name text; begin
 foreach table_name in array array['zettle_image_intents','zettle_image_uploads','zettle_image_outcomes'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('revoke all on public.%I from public,anon,authenticated',table_name);
  execute format('grant select on public.%I to authenticated',table_name);
  execute format('create policy image_read on public.%I for select to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin''))',table_name);
  execute format('create policy image_boundary on public.%I as restrictive for all to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'')) with check(false)',table_name);
  execute format('create trigger image_immutable before update or delete on public.%I for each row execute function komisio_private.preserve_zettle()',table_name);
 end loop;
end $$;

create function public.prepare_zettle_image(p_tenant uuid,p_id uuid,p_item uuid,p_merchant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); item_row public.items; export_row public.zettle_product_exports;
 prior public.zettle_image_intents; selected_photo jsonb; export_uuid uuid; fresh boolean:=false;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_item is null or p_merchant is null then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id=p_merchant) then raise exception 'ZETTLE_WRONG_MERCHANT';end if;
 select * into prior from public.zettle_image_intents where id=p_id;
 if found and (prior.tenant_id is distinct from p_tenant or prior.item_id is distinct from p_item or prior.created_by is distinct from actor) then raise exception 'REQUEST_CONFLICT';end if;
 select * into item_row from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 if item_row.origin_kind<>'reception_review' then return null;end if;
 select source.value into selected_photo
 from public.reception_reviews review_row
 join public.reception_source_revisions source_row on source_row.tenant_id=review_row.tenant_id and source_row.session_id=review_row.session_id and source_row.revision=review_row.source_revision
 cross join lateral jsonb_array_elements(source_row.sources) with ordinality source(value,position)
 where review_row.tenant_id=p_tenant and review_row.session_id=item_row.origin_id and review_row.version=item_row.origin_revision and source.value->>'kind'='photo'
 order by source.position limit 1;
 if selected_photo is null then return null;end if;
 if selected_photo->>'reference' not in (p_tenant::text||'/'||item_row.origin_id::text||'/'||(selected_photo->>'id')||'.jpg',p_tenant::text||'/'||item_row.origin_id::text||'/'||(selected_photo->>'id')||'.png') then raise exception 'INVALID_INPUT';end if;
 export_uuid:=public.prepare_zettle_product(p_tenant,p_item);
 select * into export_row from public.zettle_product_exports where tenant_id=p_tenant and id=export_uuid;
 if not exists(select 1 from public.zettle_product_outcomes outcome_row join public.zettle_product_exports product_row on product_row.tenant_id=outcome_row.tenant_id and product_row.id=outcome_row.export_id where product_row.tenant_id=p_tenant and product_row.item_id=p_item and product_row.product_id=export_row.product_id and outcome_row.status='synced') then raise exception 'ZETTLE_IMAGE_PRODUCT_REQUIRED';end if;
 select * into prior from public.zettle_image_intents where tenant_id=p_tenant and item_id=p_item;
 if found then
  if prior.merchant_id is distinct from p_merchant or prior.product_id is distinct from export_row.product_id or prior.source_reference is distinct from selected_photo->>'reference' then raise exception 'REQUEST_CONFLICT';end if;
 else
  insert into public.zettle_image_intents(id,tenant_id,item_id,export_id,merchant_id,product_id,source_reference,created_by)
  values(p_id,p_tenant,p_item,export_uuid,p_merchant,export_row.product_id,selected_photo->>'reference',actor) returning * into prior;
  fresh:=true;
 end if;
 return jsonb_build_object('id',prior.id,'fresh',fresh,'reference',prior.source_reference,'exportId',export_uuid);
end $$;

create function public.record_zettle_image_upload(p_tenant uuid,p_intent uuid,p_url text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_url is null or length(p_url)>512 or p_url !~ '^https://image[.]izettle[.]com/(product|v2/images/product)/[A-Za-z0-9_-]+([.](jpg|jpeg|png))?$' then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.zettle_image_intents where tenant_id=p_tenant and id=p_intent) then raise exception 'ITEM_NOT_FOUND';end if;
 select image_url into prior from public.zettle_image_uploads where tenant_id=p_tenant and intent_id=p_intent;
 if found then
  if prior is distinct from p_url then raise exception 'REQUEST_CONFLICT';end if;
  return;
 end if;
 insert into public.zettle_image_uploads(intent_id,tenant_id,image_url,created_by) values(p_intent,p_tenant,p_url,actor);
end $$;

create function public.zettle_item_image_url(p_tenant uuid,p_item uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return (select upload_row.image_url from public.zettle_image_intents intent_row join public.zettle_image_uploads upload_row on upload_row.tenant_id=intent_row.tenant_id and upload_row.intent_id=intent_row.id where intent_row.tenant_id=p_tenant and intent_row.item_id=p_item);
end $$;

create function public.finish_zettle_image(p_tenant uuid,p_intent uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from public.zettle_image_uploads where tenant_id=p_tenant and intent_id=p_intent) then raise exception 'ZETTLE_IMAGE_HELD';end if;
 insert into public.zettle_image_outcomes(intent_id,tenant_id,created_by) values(p_intent,p_tenant,actor) on conflict(intent_id) do nothing;
end $$;
create function public.zettle_image_status(p_tenant uuid) returns table(item_id uuid,status text)
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return query select intent_row.item_id,case when outcome_row.intent_id is not null then 'synced' when upload_row.intent_id is not null then 'uploaded' else 'held' end
 from public.zettle_image_intents intent_row
 left join public.zettle_image_uploads upload_row on upload_row.tenant_id=intent_row.tenant_id and upload_row.intent_id=intent_row.id
 left join public.zettle_image_outcomes outcome_row on outcome_row.tenant_id=intent_row.tenant_id and outcome_row.intent_id=intent_row.id
 where intent_row.tenant_id=p_tenant order by intent_row.created_at desc,intent_row.id limit 50;
end $$;
revoke all on function public.zettle_image_status(uuid) from public,anon;
grant execute on function public.zettle_image_status(uuid) to authenticated;
revoke all on function public.prepare_zettle_image(uuid,uuid,uuid,uuid),public.record_zettle_image_upload(uuid,uuid,text),public.zettle_item_image_url(uuid,uuid),public.finish_zettle_image(uuid,uuid) from public,anon;
grant execute on function public.prepare_zettle_image(uuid,uuid,uuid,uuid),public.record_zettle_image_upload(uuid,uuid,text),public.zettle_item_image_url(uuid,uuid),public.finish_zettle_image(uuid,uuid) to authenticated;
