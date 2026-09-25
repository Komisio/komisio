import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

/** A label is a short UUID prefix, not necessarily a unique item identity. */
export async function readItemReference(
  client: SupabaseClient,
  tenant: string,
  reference: string,
): Promise<string[]> {
  const match = /^I-?([0-9A-F]{8})$/i.exec(reference.trim())
  if (!match) return []
  const prefix = match[1].toLowerCase()
  const result = await client
    .from('items')
    .select('id')
    .eq('tenant_id', z.uuid().parse(tenant))
    .gte('id', prefix + '-0000-0000-0000-000000000000')
    .lte('id', prefix + '-ffff-ffff-ffff-ffffffffffff')
    .order('id')
    .limit(2)
  if (result.error) throw new Error('Unable to resolve item reference')
  return z
    .array(z.object({ id: z.guid() }))
    .max(2)
    .parse(result.data ?? [])
    .map((item) => item.id)
}
