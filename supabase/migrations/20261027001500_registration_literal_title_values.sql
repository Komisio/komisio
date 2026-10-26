-- Substitute template tokens once: braces inside observed values are literal text.
create function komisio_private.render_registration_title(p_template text,p_values jsonb) returns text
language sql immutable set search_path='' as $$
 select left(trim(regexp_replace(coalesce(string_agg(case when left(m[1],1)='{' then coalesce(p_values->>trim(m[1],'{}'),'') else m[1] end,'' order by n),''),'[[:space:]]+',' ','g')),1000)
 from regexp_matches(p_template,'(\{(?:type|brand|size|color|condition|material)\}|[^{}]+)','g') with ordinality parts(m,n);
$$;
revoke all on function komisio_private.render_registration_title(text,jsonb) from public,anon,authenticated;
create or replace function komisio_private.item_title(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare title_values jsonb:='{}'; attrs jsonb; title text; template text; token text; val text; kind text; lang text; def public.attribute_definitions;
begin
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then return jsonb_build_object('title',null,'category',null,'condition',null); end if;
 attrs:=komisio_private.item_attributes(p_tenant,p_item);
 select nullif(trim(a->>'value'),'') into title from jsonb_array_elements(attrs) a where a->>'slug'='description' limit 1;
 if title is null then
  template:=komisio_private.registration_settings(p_tenant)->'settings'->>'titleTemplate';
  lang:=coalesce(komisio_private.current_store_policy_core(p_tenant)->'policy'->>'itemLanguage','sv');
  kind:=komisio_private.item_classification(p_tenant,p_item)->>'itemType';
  foreach token in array array['type','brand','size','color','condition','material'] loop
   val:=null;
   if token='type' then
    select coalesce(labels->>lang,labels->>'en',slug) into val from public.item_types where slug=kind and (tenant_id=p_tenant or tenant_id is null) order by (tenant_id is not null) desc limit 1;
   else
    select a->>'value' into val from jsonb_array_elements(attrs) a where a->>'slug'=token limit 1;
    select * into def from public.attribute_definitions where slug=token and (tenant_id=p_tenant or tenant_id is null) order by (tenant_id is not null) desc,version desc limit 1;
    if def.data_type='choice' then
     val:=coalesce((select coalesce(c->'labels'->>lang,c->'labels'->>'en',val) from jsonb_array_elements(def.choices) c where c->>'id'=val limit 1),val);
    end if;
   end if;
   title_values:=title_values||jsonb_build_object(token,coalesce(val,''));
  end loop;
  title:=coalesce(nullif(komisio_private.render_registration_title(template,title_values),''),'I-'||upper(left(p_item::text,8)));
 end if;
 return jsonb_build_object('title',title,'category',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='category' limit 1),'condition',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='condition' limit 1));
end $$;

