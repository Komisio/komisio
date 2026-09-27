-- Presentation correction from the translation review. The preceding
-- vocabulary migration is already applied locally and remains immutable.
update public.attribute_definitions
set labels=jsonb_set(labels,'{fi}','"Istuvuus"'::jsonb)
where tenant_id is null and slug='fit' and labels->>'fi'='Malli';
