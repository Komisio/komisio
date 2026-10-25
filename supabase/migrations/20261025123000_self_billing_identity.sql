-- Keep document language and correction contact aligned with frozen identity.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('komisio_private.statement_self_billing()'::regprocedure);
 if position($needle$'version',1,'currency'$needle$ in definition)=0 then raise exception 'UNEXPECTED_SELF_BILLING'; end if;
 execute replace(definition,$needle$'version',1,'currency'$needle$,$patch$'version',1,'language',coalesce(nullif(seller.profile->>'language',''),(select profile->>'language' from public.store_profile_versions where tenant_id=new.tenant_id order by version desc limit 1),(select policy->>'communicationLanguage' from public.store_policy_versions where tenant_id=new.tenant_id order by version desc limit 1),'en'),'currency'$patch$);
 definition:=pg_get_functiondef('komisio_private.statement_seller_contact()'::regprocedure);
 if position('if tg_op=''INSERT'' then' in definition)=0 then raise exception 'UNEXPECTED_STATEMENT_CONTACT'; end if;
 execute replace(definition,'if tg_op=''INSERT'' then',$patch$if tg_op='INSERT' then
  if new.corrects_id is not null and exists(select 1 from public.settlement_statements where tenant_id=new.tenant_id and id=new.corrects_id and self_billing is not null) then
   select seller_contact into new.seller_contact from public.settlement_statements where tenant_id=new.tenant_id and id=new.corrects_id;
   return new;
  end if;
 $patch$);
end $$;
