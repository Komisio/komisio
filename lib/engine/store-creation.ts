import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { locales } from '@/lib/i18n'

const creation = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  requestId: z.uuid(),
  locale: z.enum(locales),
})

// SQL creates membership and the initial currency policy atomically.
export async function createStore(client: SupabaseClient, input: unknown) {
  const command = creation.parse(input)
  return client.rpc('create_tenant_with_locale', {
    p_name: command.name,
    p_slug: command.slug,
    p_request_id: command.requestId,
    p_locale: command.locale,
  })
}
