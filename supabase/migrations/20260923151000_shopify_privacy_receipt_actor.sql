-- Preserve receiver attribution on each durable receipt.
create or replace function public.receive_shopify_privacy(p_topic text,p_shop text,p_fingerprint text,p_cipher jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); matched integer; tid uuid;
begin
 if not exists(select 1 from komisio_private.shopify_privacy_actors where user_id=uid)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_topic is null or p_topic not in ('customers/data_request','customers/redact','shop/redact')
 or p_shop is null or length(p_shop)>120 or p_shop !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
 or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
 or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not(p_cipher ?& array['iv','tag','data']) or octet_length(p_cipher::text)>400000
 then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended('shopify-privacy:'||p_topic||':'||p_shop||':'||p_fingerprint,0));
 if exists(select 1 from public.shopify_privacy_requests where topic=p_topic and shop_domain=p_shop and fingerprint=p_fingerprint)
 then return jsonb_build_object('replayed',true); end if;
 matched:=0;
 for tid in select distinct tenant_id from public.shopify_connection_events
  where kind in ('connected','refreshed') and detail->>'shop_domain'=p_shop
 loop
  insert into public.shopify_privacy_requests(tenant_id,topic,shop_domain,fingerprint,cipher,received_by)
  values(tid,p_topic,p_shop,p_fingerprint,p_cipher,uid);
  matched:=matched+1;
 end loop;
 if matched=0 then
  insert into public.shopify_privacy_requests(tenant_id,topic,shop_domain,fingerprint,cipher,received_by)
  values(null,p_topic,p_shop,p_fingerprint,p_cipher,uid);
 end if;
 return jsonb_build_object('replayed',false,'matched',matched);
end $$;

