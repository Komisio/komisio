-- #532: feedback is tenant-scoped, contains no user ID and is operator-readable only.
create table public.help_feedback (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 slug text not null check(length(slug)<=80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 locale text not null check(locale in ('sv','en','no','dk','fi','de','es','it')),
 page text not null check(length(page)<=200 and left(page,1)='/'),
 helpful boolean not null,
 comment text check(comment is null or (length(comment)<=1000 and length(comment)>0)),
 created_at timestamptz not null default now()
);
create index help_feedback_tenant_time on public.help_feedback(tenant_id,created_at);
alter table public.help_feedback enable row level security;
revoke all on public.help_feedback from public,anon,authenticated;
comment on table public.help_feedback is 'Operator-only article feedback; no user identifiers. Comments are free text. No automatic retention.';

create function public.submit_help_feedback(p_tenant uuid,p_slug text,p_locale text,p_page text,p_helpful boolean,p_comment text default null)
returns void language plpgsql security definer set search_path='' as $$
declare clean_comment text:=nullif(btrim(p_comment,E' \t\n\r'),''); page_path text:=split_part(p_page,'?',1);
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 perform komisio_private.require_identity();
 if p_slug is null or length(p_slug)>80 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 or p_locale is null or p_locale not in ('sv','en','no','dk','fi','de','es','it')
 or p_helpful is null or length(p_comment)>1000
 or p_page is null or length(p_page)>200
 or page_path not in (
  '/',
  '/account',
  '/guide',
  '/help',
  '/host',
  '/intake',
  '/intake/accounting',
  '/intake/agreements',
  '/intake/bags',
  '/intake/economy',
  '/intake/flow',
  '/intake/handovers',
  '/intake/import',
  '/intake/import/items',
  '/intake/import/pos',
  '/intake/integrations',
  '/intake/integrations/privacy',
  '/intake/items',
  '/intake/items/classify',
  '/intake/items/labels',
  '/intake/lifecycle',
  '/intake/open',
  '/intake/operations',
  '/intake/payouts',
  '/intake/payouts/payment-sheet',
  '/intake/pricing',
  '/intake/purchases',
  '/intake/quick',
  '/intake/reception',
  '/intake/sales',
  '/intake/sellers',
  '/intake/sellers/email',
  '/intake/sellers/new',
  '/intake/sellers/registrations',
  '/intake/stock',
  '/intake/stocktake',
  '/intake/submissions',
  '/members',
  '/menu',
  '/settings',
  '/settings/seller-registration',
  '/help/[topic]',
  '/intake/accounting/exports/[id]',
  '/intake/bags/[id]',
  '/intake/bags/[id]/inspect',
  '/intake/integrations/[id]',
  '/intake/items/[id]',
  '/intake/items/[id]/label',
  '/intake/operations/[id]',
  '/intake/purchases/[id]',
  '/intake/reception/[id]',
  '/intake/reception/[id]/history',
  '/intake/reception/[id]/label',
  '/intake/sales/[id]',
  '/intake/sellers/[id]',
  '/intake/sellers/[id]/privacy',
  '/intake/statements/[id]',
  '/[page]'
 )
 or (p_page<>page_path and not (
   (page_path='/intake/accounting' and p_page in ('/intake/accounting?view=days','/intake/accounting?view=exports','/intake/accounting?view=reconciliation','/intake/accounting?view=accounts','/intake/accounting?view=settings','/intake/accounting?view=planning'))
   or (page_path='/intake/submissions' and p_page in ('/intake/submissions?view=all','/intake/submissions?view=pending','/intake/submissions?view=invited','/intake/submissions?view=registered'))
   or (page_path='/settings' and p_page in ('/settings?tab=policy','/settings?tab=profile','/settings?tab=vocabulary','/settings?tab=store','/settings?tab=printing','/settings?tab=credits','/settings?tab=connectors'))
 )) then raise exception 'INVALID_INPUT'; end if;
 -- All submitters for this tenant share the same lock before counting.
 perform 1 from public.tenants where id=p_tenant for update;
 if (select count(*) from public.help_feedback where tenant_id=p_tenant and created_at>=now()-interval '24 hours')>=200 then
  raise exception 'RATE_LIMITED';
 end if;
 insert into public.help_feedback(tenant_id,slug,locale,page,helpful,comment)
 values(p_tenant,p_slug,p_locale,p_page,p_helpful,clean_comment);
end $$;
revoke all on function public.submit_help_feedback(uuid,text,text,text,boolean,text) from public,anon;
grant execute on function public.submit_help_feedback(uuid,text,text,text,boolean,text) to authenticated;
