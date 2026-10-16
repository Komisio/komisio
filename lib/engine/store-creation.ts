import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { currencyCode } from './money'
import { locales } from '../i18n'

const creation = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  requestId: z.uuid(),
  locale: z.enum(locales),
  currency: currencyCode.optional(),
})

// SQL creates membership and the initial currency policy atomically.
export async function createStore(client: SupabaseClient, input: unknown) {
  const command = creation.parse(input)
  const result = await client.rpc('create_tenant_with_result', {
    p_name: command.name,
    p_slug: command.slug,
    p_request_id: command.requestId,
    p_locale: command.locale,
    p_currency: command.currency ?? null,
  })
  if (result.error) return { data: null, error: result.error, created: false }
  const data = z
    .object({ tenant_id: z.uuid(), created: z.boolean() })
    .parse(result.data)
  // Preserve the platform API's UUID response while exposing the atomic first-create flag.
  return { data: data.tenant_id, error: null, created: data.created }
}
