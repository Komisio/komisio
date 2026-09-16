-- Optional country preserves existing immutable profiles; new versions select the credit payment currency.
create or replace function komisio_private.valid_store_profile(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare h jsonb; n integer:=0; a jsonb; c jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['address','contact','openingHours','accepts','concept','language']) or (value-array['address','contact','openingHours','accepts','concept','language'])<>'{}'::jsonb then return false; end if;
 a:=value->'address';
 if jsonb_typeof(a)<>'object' or not(a ?& array['street','postalCode','city']) or (a-array['street','postalCode','city','country'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(a->'street')<>'string' or length(a->>'street')>120 or jsonb_typeof(a->'postalCode')<>'string' or length(a->>'postalCode')>20 or jsonb_typeof(a->'city')<>'string' or length(a->>'city')>120 then return false; end if;
 if a ? 'country' and (jsonb_typeof(a->'country') is distinct from 'string' or a->>'country' not in ('SE','NO','DK','FI','DE','ES','IT','GB','IE','FR','NL','BE','AT','PT','GR','EE','LV','LT','LU','CY','MT','SK','SI','HR','PL','CZ','HU','RO','BG','IS','LI','CH')) then return false; end if;
 c:=value->'contact';
 if jsonb_typeof(c)<>'object' or not(c ?& array['email','phone','website']) or (c-array['email','phone','website'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(c->'email')<>'string' or length(c->>'email')>254 or (c->>'email'<>'' and c->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then return false; end if;
 if jsonb_typeof(c->'phone')<>'string' or length(c->>'phone')>40 then return false; end if;
 if jsonb_typeof(c->'website')<>'string' or length(c->>'website')>200 or (c->>'website'<>'' and c->>'website' !~ '^https://[^\s]+$') then return false; end if;
 if jsonb_typeof(value->'openingHours')<>'array' or jsonb_array_length(value->'openingHours')>7 then return false; end if;
 for h in select * from jsonb_array_elements(value->'openingHours') loop
  n:=n+1;
  if jsonb_typeof(h)<>'object' or not(h ?& array['day','opens','closes']) or (h-array['day','opens','closes'])<>'{}'::jsonb then return false; end if;
  if h->>'day' not in ('mon','tue','wed','thu','fri','sat','sun') then return false; end if;
  if jsonb_typeof(h->'opens')<>'string' or (h->>'opens') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(h->'closes')<>'string' or (h->>'closes') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (h->>'opens')>=(h->>'closes') then return false; end if;
 end loop;
 if (select count(distinct e->>'day') from jsonb_array_elements(value->'openingHours') e)<>n then return false; end if;
 if jsonb_typeof(value->'accepts')<>'string' or length(value->>'accepts')>2000 or jsonb_typeof(value->'concept')<>'string' or length(value->>'concept')>2000 then return false; end if;
 if value->>'language' not in ('sv','en') then return false; end if;
 return true;
end $$;
