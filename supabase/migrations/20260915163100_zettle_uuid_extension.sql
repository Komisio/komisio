-- Explicit dependency for self-hosted installs as well as hosted Supabase.
create extension if not exists "uuid-ossp" with schema extensions;
