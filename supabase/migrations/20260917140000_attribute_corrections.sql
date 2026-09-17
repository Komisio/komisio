-- Corrections after reception (2026-09-17, fourth slice; the owner's review
-- called this an everyday function rather than a technical detail).
--
-- A sweater is received and recorded as size M. Two weeks later a member of
-- staff reads the label and it is L. Both things have to stay true: the shelf
-- must say L, and the seller's approved review must still say M.
--
-- The item binds to a specific origin revision. That binding is what the
-- seller approved and what the commission terms attach to, so it never moves.
-- A correction is therefore a new row, never an edit of the evidence, the same
-- shape item_prices already uses for a price history. The read overlays them
-- and returns both values, so nothing is hidden and nothing is rewritten.
--
-- A correction carries no financial consequence, so it needs no second
-- approver. It does need a reason, because a value that changed without one is
-- indistinguishable from a mistake.
create table public.item_attribute_corrections (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 item_id uuid not null,
 slug text not null check(slug ~ '^[a-z][a-z0-9_]{0,39}$'),
 definition_version integer not null check(definition_version>0),
 value text not null check(length(value) between 1 and 1000),
 reason text not null check(length(reason) between 1 and 500),
 corrected_by uuid not null references auth.users(id),
 corrected_at timestamptz not null default now(),
 -- now() is the transaction clock, so two corrections made in one transaction
 -- share a timestamp and cannot order themselves. The sequence decides which
 -- came last; the timestamp is for reading.
 seq bigint generated always as identity,
 foreign key (tenant_id,item_id) references public.items(tenant_id,id)
);
create index item_attribute_corrections_item on public.item_attribute_corrections(tenant_id,item_id,slug,seq desc);

create function komisio_private.preserve_correction() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_CORRECTION'; end $$;
create trigger correction_immutable before update or delete on public.item_attribute_corrections for each row execute function komisio_private.preserve_correction();

alter table public.item_attribute_corrections enable row level security;
revoke all on public.item_attribute_corrections from public,anon,authenticated;
grant select on public.item_attribute_corrections to authenticated;
create policy read_store on public.item_attribute_corrections for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy write_boundary on public.item_attribute_corrections as restrictive for all to authenticated using(true) with check(false);

-- Correct one attribute of one item. Idempotent by request id: a retry of the
-- same correction returns it rather than recording it twice.
create function public.correct_item_attribute(p_tenant uuid,p_id uuid,p_item uuid,p_slug text,p_value text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.item_attribute_corrections; ver integer; v text; r text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 v:=trim(coalesce(p_value,'')); r:=trim(coalesce(p_reason,''));
 if p_id is null or p_item is null or p_slug is null or p_slug !~ '^[a-z][a-z0-9_]{0,39}$'
  or length(v) not between 1 and 1000 or length(r) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.item_attribute_corrections where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.item_id<>p_item or prior.slug<>p_slug or prior.value<>v or prior.reason<>r or prior.corrected_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('corrected',true,'replayed',true,'slug',p_slug,'value',v);
 end if;
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then raise exception 'ITEM_NOT_FOUND'; end if;
 -- The same rule as a reception: a correction names an attribute the store's
 -- vocabulary defines, so correcting cannot grow the vocabulary either.
 select max(d.version) into ver from public.attribute_definitions d
  where d.slug=p_slug and (d.tenant_id is null or d.tenant_id=p_tenant)
    and (d.tenant_id is not null or not exists(select 1 from public.attribute_definitions o where o.slug=p_slug and o.tenant_id=p_tenant));
 if ver is null then raise exception 'ATTRIBUTE_UNDEFINED'; end if;
 insert into public.item_attribute_corrections(id,tenant_id,item_id,slug,definition_version,value,reason,corrected_by)
 values(p_id,p_tenant,p_item,p_slug,ver,v,r,uid);
 perform komisio_private.record_access(p_tenant,'item.attribute_corrected',p_item,jsonb_build_object('slug',p_slug,'reason',r));
 return jsonb_build_object('corrected',true,'replayed',false,'slug',p_slug,'value',v);
end $$;
revoke all on function public.correct_item_attribute(uuid,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.correct_item_attribute(uuid,uuid,uuid,text,text,text) to authenticated;

-- The read now overlays corrections. The latest correction per slug wins and
-- the accepted value travels with it, so a stock list can show L while the
-- seller's approved review can still be produced saying M.
create or replace function komisio_private.item_attributes(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; out jsonb:='[]'::jsonb; d record; note text; merged jsonb:='[]'::jsonb; a jsonb; c record; seen text[]:='{}';
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return '[]'::jsonb; end if;
 if item.origin_kind='reception_review' then
  select coalesce(suggestions->'attributes',komisio_private.metadata_to_attributes(suggestions->'metadata')) into out
   from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 elsif item.origin_kind='inspection_draft' then
  select description,category,condition into d from public.inspection_draft_revisions
   where tenant_id=p_tenant and draft_id=item.origin_id and revision=item.origin_revision;
  out:=(select coalesce(jsonb_agg(jsonb_build_object('slug',s,'definitionVersion',1,'value',v,'sourceIds','[]'::jsonb,'certainty','observed')),'[]'::jsonb)
        from (values('description',d.description),('category',d.category),('condition',d.condition)) as f(s,v)
        where nullif(trim(coalesce(v,'')),'') is not null);
 else
  select supplier_note into note from public.purchase_receipts where tenant_id=p_tenant and id=item.origin_id;
  if nullif(trim(coalesce(note,'')),'') is not null then
   out:=jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',1,'value',note,'sourceIds','[]'::jsonb,'certainty','observed'));
  end if;
 end if;
 out:=coalesce(out,'[]'::jsonb);
 for a in select * from jsonb_array_elements(out) loop
  select * into c from public.item_attribute_corrections k
   where k.tenant_id=p_tenant and k.item_id=p_item and k.slug=a->>'slug'
   order by k.seq desc limit 1;
  if found then
   merged:=merged||jsonb_build_array(a||jsonb_build_object('value',c.value,'definitionVersion',c.definition_version,'source','corrected',
    'accepted',jsonb_build_object('value',a->>'value','at',item.accepted_at),
    'correctedBy',c.corrected_by,'correctedAt',c.corrected_at,'reason',c.reason));
  else
   merged:=merged||jsonb_build_array(a||jsonb_build_object('source','accepted'));
  end if;
  seen:=seen||(a->>'slug');
 end loop;
 -- A correction may also add something the reception never recorded, such as a
 -- socket nobody noted at the counter.
 for c in select distinct on (k.slug) k.* from public.item_attribute_corrections k
   where k.tenant_id=p_tenant and k.item_id=p_item and not(k.slug=any(seen))
   order by k.slug, k.seq desc loop
  merged:=merged||jsonb_build_array(jsonb_build_object('slug',c.slug,'definitionVersion',c.definition_version,'value',c.value,
   'sourceIds','[]'::jsonb,'certainty','observed','source','corrected','accepted',null,
   'correctedBy',c.corrected_by,'correctedAt',c.corrected_at,'reason',c.reason));
 end loop;
 return merged;
end $$;
