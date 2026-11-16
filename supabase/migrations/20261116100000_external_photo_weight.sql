-- Keep model estimates separate from actual parcel measurements. Existing
-- attempts/results provide immutable provenance; no new core table is needed.
alter table public.external_item_requests add column weight_analysis_id uuid
 references public.external_photo_ai_results(id);

-- Retain the old five-argument entry point for in-flight/older servers. Both
-- versions use the same capability, ownership, quota, credit and lock rules.
do $$ declare definition text; begin
 definition:=replace(pg_get_functiondef('public.begin_external_photo_analysis(uuid,uuid,uuid[],text,text)'::regprocedure),E'\r','');
 if position('p_language text)' in definition)=0
  or position('a.language<>p_language or a.model<>p_model' in definition)=0
  or position('photos,evidence,language,model) values(p_id,p_tenant,uid,p_photos,evidence,p_language,p_model)' in definition)=0
 then raise exception 'UNEXPECTED_PHOTO_ANALYSIS_BEGIN'; end if;
 definition:=replace(definition,'p_language text)','p_language text, p_prompt_version text)');
 definition:=replace(definition,'uid:=komisio_private.external_phone_owner();',
  'uid:=komisio_private.external_phone_owner();
   if p_prompt_version is null or p_prompt_version not in (''central-photo-v1'',''central-photo-v2-weight'') then raise exception ''INVALID_INPUT''; end if;');
 definition:=replace(definition,'a.language<>p_language or a.model<>p_model',
  'a.language<>p_language or a.model<>p_model or a.prompt_version<>p_prompt_version');
 definition:=replace(definition,
  'photos,evidence,language,model) values(p_id,p_tenant,uid,p_photos,evidence,p_language,p_model)',
  'photos,evidence,language,model,prompt_version) values(p_id,p_tenant,uid,p_photos,evidence,p_language,p_model,p_prompt_version)');
 execute definition;
end $$;
create or replace function public.begin_external_photo_analysis(p_id uuid,p_tenant uuid,p_photos uuid[],p_model text,p_language text) returns jsonb
language sql security invoker set search_path='' as $$
 select public.begin_external_photo_analysis(p_id,p_tenant,p_photos,p_model,p_language,'central-photo-v1');
$$;
revoke all on function public.begin_external_photo_analysis(uuid,uuid,uuid[],text,text,text) from public,anon,authenticated;
grant execute on function public.begin_external_photo_analysis(uuid,uuid,uuid[],text,text,text) to authenticated;

do $$ declare definition text; needle text:='p_output-array[''description'',''brand'',''condition'',''notes'']<>''{}''::jsonb'; begin
 definition:=replace(pg_get_functiondef('public.complete_external_photo_analysis(uuid,jsonb,integer,integer)'::regprocedure),E'\r','');
 if position(needle in definition)=0 or position('if p_output is not null then' in definition)=0 then raise exception 'UNEXPECTED_PHOTO_ANALYSIS_COMPLETE'; end if;
 definition:=replace(definition,needle,
  'p_output-(case when a.prompt_version=''central-photo-v2-weight'' then array[''description'',''brand'',''condition'',''notes'',''estimatedWeightG''] else array[''description'',''brand'',''condition'',''notes''] end)<>''{}''::jsonb');
 definition:=replace(definition,'if p_output is not null then',
  'if p_output is not null then
   if a.prompt_version=''central-photo-v2-weight'' and (
    not(p_output ? ''estimatedWeightG'') or
    (p_output->''estimatedWeightG''<>''null''::jsonb and not(case
     when jsonb_typeof(p_output->''estimatedWeightG'')=''number'' and (p_output->>''estimatedWeightG'') ~ ''^[1-9][0-9]{0,5}$''
     then (p_output->>''estimatedWeightG'')::integer<=100000 else false end))
   ) then raise exception ''INVALID_INPUT''; end if;');
 execute definition;
end $$;

-- The seller-facing JSON remains exactly the existing descriptive contract,
-- including on old app versions that reject unexpected properties.
do $$ declare definition text; begin
 definition:=replace(pg_get_functiondef('public.my_external_photo_analysis(uuid)'::regprocedure),E'\r','');
 if position('''output'',r.output)' in definition)=0 then raise exception 'UNEXPECTED_PHOTO_ANALYSIS_READ'; end if;
 execute replace(definition,'''output'',r.output)','''output'',r.output-''estimatedWeightG'')');
end $$;

create function komisio_private.freeze_external_weight_analysis() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Always derive the reference. A caller cannot nominate someone else's
 -- result, a different image set, or a later analysis of submitted evidence.
 select a.id into new.weight_analysis_id
 from public.external_photo_ai_attempts a
 join public.external_photo_ai_results r on r.id=a.id and r.tenant_id=a.tenant_id
 where a.owner_id=new.owner_id and a.tenant_id=new.tenant_id
  and a.photos=new.photos and a.prompt_version='central-photo-v2-weight'
  and r.output is not null and r.created_at<=new.created_at
 order by r.created_at desc,a.id limit 1;
 return new;
end $$;
revoke all on function komisio_private.freeze_external_weight_analysis() from public,anon,authenticated;
create trigger freeze_weight_analysis before insert on public.external_item_requests
 for each row execute function komisio_private.freeze_external_weight_analysis();

-- Extend only the staff read model, after its tenant/MFA authorization and
-- pagination. Registered items retain the same request through their guarantee.
do $$ declare definition text; needle text:='r.photos,r.created_at,r.decline_note,r.declined,r.queue_status,'; begin
 definition:=replace(pg_get_functiondef('public.external_item_offer_queue_filtered(uuid,integer,text,text)'::regprocedure),E'\r','');
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_EXTERNAL_QUEUE'; end if;
 execute replace(definition,needle,needle||'
   (select (a.output->>''estimatedWeightG'')::integer from public.external_photo_ai_results a where a.id=r.weight_analysis_id and a.tenant_id=p_tenant) as estimated_weight_g,');
end $$;
