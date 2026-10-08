-- PostgreSQL's built-in digest also works in isolated databases without pgcrypto.
create or replace function komisio_private.require_seller_ai_server() returns void
language plpgsql stable security definer set search_path='' as $$
declare token text:=coalesce(current_setting('request.headers',true)::jsonb->>'x-komisio-seller-ai','');
begin
 if length(token)<>64 or not exists(select 1 from komisio_private.seller_ai_runtime where key_hash=encode(sha256(convert_to(token,'UTF8')),'hex')) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
end $$;
