-- Read-only pilot evidence: saved predictions, never retrospective AI reruns.
create function public.pricing_follow_up(p_tenant uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare market text; currency text; result jsonb; n integer;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
  or p_to<p_from or p_to-p_from>365 or p_to>(now() at time zone 'Europe/Stockholm')::date then raise exception 'INVALID_INPUT'; end if;
 select profile->'address'->>'country' into market from public.store_profile_versions where tenant_id=p_tenant order by version desc limit 1;
 currency:=komisio_private.store_currency(p_tenant);
 -- Refuse truncation: a small successful subset must never look like the cohort.
 select count(*) into n from (
  select i.id from public.items i join public.submission_receptions sr on sr.tenant_id=i.tenant_id and sr.session_id=i.origin_id
  where i.tenant_id=p_tenant and i.origin_kind='reception_review'
   and i.accepted_at>=p_from::timestamp at time zone 'Europe/Stockholm'
   and i.accepted_at<(p_to+1)::timestamp at time zone 'Europe/Stockholm'
  limit 5001
 ) bounded;
 if n>5000 then raise exception 'PERIOD_TOO_LARGE'; end if;
 with received as (
  select i.id,i.accepted_at,i.terms,s.assistance_output,a.context,r.created_at as predicted_at,
   a.id as assessment_id,
   coalesce(nullif(s.assistance_output->'suggestion'->'price','null'),
    nullif(s.assistance_output->'suggestion'->'externalComparison','null'),
    nullif(s.assistance_output->'suggestion'->'approximatePrice','null')) as estimate,
   case when nullif(s.assistance_output->'suggestion'->'price','null') is not null then 'store_sales'
    when nullif(s.assistance_output->'suggestion'->'externalComparison','null') is not null then 'web'
    else 'model_estimate' end as basis,
   case when policy.id is not null then coalesce(policy.policy->>'currency','SEK')
    when coalesce((i.terms->>'storePolicyVersion')::integer,0)=0 then 'SEK' end as accepted_currency,
   price.price_ore as accepted_ore, sale.occurred_at as sold_at,sale.price_ore as sold_ore,sale.currency as sold_currency,sale.returned
  from public.items i
  join public.submission_receptions sr on sr.tenant_id=i.tenant_id and sr.session_id=i.origin_id
  join public.seller_submissions s on s.tenant_id=sr.tenant_id and s.id=sr.submission_id
  left join public.seller_ai_attempts a on a.tenant_id=s.tenant_id and a.id=s.assistance_id and a.seller_id=s.seller_id
  left join public.seller_ai_results r on r.tenant_id=a.tenant_id and r.id=a.id and r.output is not null
  left join public.store_policy_versions policy on policy.tenant_id=i.tenant_id and policy.id=(i.terms->>'storePolicyId')::uuid
  left join lateral (
   select p.price_ore from public.item_prices p where p.tenant_id=i.tenant_id and p.item_id=i.id and p.reason='accepted' order by p.set_at,p.seq limit 1
  ) price on true
  left join lateral (
   select s.occurred_at,l.price_ore,s.currency,exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id) as returned
   from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
   where l.tenant_id=i.tenant_id and l.item_id=i.id and s.status='completed' and s.occurred_at<=now()
   order by s.occurred_at desc,s.recorded_at desc,l.id desc limit 1
  ) sale on true
  where i.tenant_id=p_tenant and i.origin_kind='reception_review'
   and i.accepted_at>=p_from::timestamp at time zone 'Europe/Stockholm'
   and i.accepted_at<(p_to+1)::timestamp at time zone 'Europe/Stockholm'
 ), classified as (
  select *,assessment_id is not null and predicted_at is not null and assistance_output is not null as assessed,
   context->>'country'=market and context->>'currency'=currency and assistance_output->>'currency'=currency
    and accepted_currency=currency and (sold_currency is null or sold_currency=currency) as comparable,
   estimate is not null and (predicted_at>=accepted_at or predicted_at>=sold_at) as hindsight
  from received
 ), eligible as (
  select *,jsonb_build_object('itemId',id,'currency',currency,
   'prediction',case when estimate is not null and not coalesce(hindsight,false) then
    jsonb_build_object('at',predicted_at,'lowOre',((estimate->>'from')::numeric*100)::bigint,'highOre',((estimate->>'to')::numeric*100)::bigint,'basis',basis) end,
   'staffDecision',case when accepted_ore is not null then jsonb_build_object('at',accepted_at,'priceOre',accepted_ore) end,
   'sale',case when sold_at is not null then jsonb_build_object('at',sold_at,'priceOre',sold_ore,'returned',returned) end) as observation
  from classified where assessed and comparable
 )
 select jsonb_build_object('from',p_from,'to',p_to,'asOf',now(),'marketCountry',market,'currency',currency,
  'receivedItems',n,
  'withoutAssessment',(select count(*) from classified where not assessed),
  'otherMarketOrCurrency',(select count(*) from classified where assessed and not coalesce(comparable,false)),
  'invalidTiming',(select count(*) from eligible where hindsight),
  'cohort',case when exists(select 1 from eligible) then jsonb_build_object('version',1,'marketCountry',market,'currency',currency,
   'observations',(select jsonb_agg(observation order by accepted_at,id) from eligible)) end)
 into result;
 return result;
end $$;
revoke all on function public.pricing_follow_up(uuid,date,date) from public,anon;
grant execute on function public.pricing_follow_up(uuid,date,date) to authenticated;
