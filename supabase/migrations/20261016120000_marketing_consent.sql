-- Owner decision #466: self-only, append-only user-level product-news consent.
create table public.marketing_consent_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete restrict,
 consented boolean not null,
 recorded_at timestamptz not null default clock_timestamp(),
 text_version text not null check (text_version = 'product-news-v1'),
 source text not null check (source in ('signup', 'account'))
);
create index marketing_consent_user_latest on public.marketing_consent_events(user_id, id desc);
alter table public.marketing_consent_events enable row level security;
alter table public.marketing_consent_events force row level security;
revoke all on public.marketing_consent_events from public, anon, authenticated;
grant select on public.marketing_consent_events to authenticated;
create policy marketing_consent_self_read on public.marketing_consent_events
 for select to authenticated using (user_id = auth.uid() and public.verified_session());

create function komisio_private.preserve_marketing_consent() returns trigger
language plpgsql set search_path = '' as $$
begin
 raise exception 'IMMUTABLE_MARKETING_CONSENT';
end $$;
create trigger preserve_marketing_consent before update or delete on public.marketing_consent_events
 for each row execute function komisio_private.preserve_marketing_consent();

-- Capture only explicit, typed signup metadata on the initial Auth insert.
-- Later user_metadata edits, duplicate signups and activation without this field
-- must never grant/reinstate consent. Email verification is still required for use.
create function komisio_private.capture_signup_marketing_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if jsonb_typeof(new.raw_user_meta_data->'marketing_consent') = 'boolean'
    and new.raw_user_meta_data->>'marketing_consent_version' = 'product-news-v1' then
  insert into public.marketing_consent_events(user_id, consented, text_version, source)
  values(new.id, (new.raw_user_meta_data->>'marketing_consent')::boolean, 'product-news-v1', 'signup');
 end if;
 return new;
end $$;
create trigger capture_signup_marketing_consent after insert on auth.users
 for each row execute function komisio_private.capture_signup_marketing_consent();

create function public.my_marketing_consent() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := komisio_private.require_identity(); result jsonb;
begin
 select jsonb_build_object('consented', consented, 'recorded_at', recorded_at, 'text_version', text_version)
 into result from public.marketing_consent_events where user_id = uid order by id desc limit 1;
 return coalesce(result, jsonb_build_object('consented', false, 'recorded_at', null, 'text_version', null));
end $$;

create function public.set_marketing_consent(p_consented boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := komisio_private.require_identity(); previous public.marketing_consent_events;
begin
 if p_consented is null then raise exception 'INVALID_INPUT'; end if;
 -- Serialize this person's changes and avoid duplicate evidence on repeated saves.
 perform pg_advisory_xact_lock(hashtextextended('marketing-consent:' || uid::text, 0));
 select * into previous from public.marketing_consent_events where user_id = uid order by id desc limit 1;
 if previous.id is null or previous.consented <> p_consented or previous.text_version <> 'product-news-v1' then
  insert into public.marketing_consent_events(user_id, consented, text_version, source)
  values(uid, p_consented, 'product-news-v1', 'account');
 end if;
 return public.my_marketing_consent();
end $$;
revoke all on function komisio_private.preserve_marketing_consent(), komisio_private.capture_signup_marketing_consent(), public.my_marketing_consent(), public.set_marketing_consent(boolean) from public, anon, authenticated;
grant execute on function public.my_marketing_consent(), public.set_marketing_consent(boolean) to authenticated;
