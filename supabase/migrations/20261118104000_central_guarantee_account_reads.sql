-- Surface the already explicit Auth-to-seller binding through the existing
-- mobile account/balance protocol. Contact email never grants this ownership.
create function komisio_private.central_seller_id(p_tenant uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select s.id from public.sellers s join public.platform_settings p on p.central_app_tenant_id=s.tenant_id
 where s.tenant_id=p_tenant and s.external_owner_id=auth.uid() and s.privacy_closed_at is null and public.verified_session();
$$;
revoke all on function komisio_private.central_seller_id(uuid) from public,anon,authenticated;

do $$ declare d text; needle text; begin
 d:=pg_get_functiondef('komisio_private.require_seller(uuid,uuid)'::regprocedure);
 needle:='select lower(trim(email)) into address from auth.users where id=uid;';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SELLER_IDENTITY_READ'; end if;
 execute replace(d,needle,'if komisio_private.central_seller_id(p_tenant)=p_seller then return uid; end if; '||needle);

 d:=pg_get_functiondef('public.my_seller_accounts()'::regprocedure);
 needle:='return result;';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SELLER_ACCOUNTS'; end if;
 execute replace(d,needle,'result:=result||coalesce((select jsonb_build_array(jsonb_build_object(''tenantId'',t.id,''sellerId'',s.id,''storeName'',t.name))
  from public.platform_settings p join public.tenants t on t.id=p.central_app_tenant_id
  join public.sellers s on s.tenant_id=t.id and s.id=komisio_private.central_seller_id(t.id)),''[]''::jsonb); '||needle);

 -- The same identified seller can use the existing store tab. All catalogue
 -- visibility/listing and storage-operation guards remain in place.
 d:=pg_get_functiondef('komisio_private.require_store_seller(uuid)'::regprocedure);
 needle:='select lower(trim(email)) into address from auth.users where id=uid;';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_STORE_SELLER'; end if;
 execute replace(d,needle,'if komisio_private.central_seller_id(p_tenant) is not null then return komisio_private.central_seller_id(p_tenant); end if; '||needle);
 d:=pg_get_functiondef('public.catalogue_photo_access(text,text)'::regprocedure);
 needle:='if address is null or address='''' or (select count(*) from komisio_private.email_identified_sellers where tenant_id=tid and email<>'''' and lower(trim(email))=address)<>1 then return false; end if;';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_CATALOGUE_IDENTITY'; end if;
 execute replace(d,needle,'if komisio_private.central_seller_id(tid) is null and (address is null or address='''' or (select count(*) from komisio_private.email_identified_sellers where tenant_id=tid and email<>'''' and lower(trim(email))=address)<>1) then return false; end if;');
end $$;
notify pgrst,'reload schema';
