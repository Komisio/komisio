import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

const consent = z.object({
  consented: z.boolean(),
  recorded_at: z.string().nullable(),
  text_version: z.string().nullable(),
})
export async function readMarketingConsent(client: SupabaseClient) {
  const { data, error } = await client.rpc('my_marketing_consent')
  if (error) throw new Error('Unable to read marketing preference')
  return consent.parse(data)
}
export async function saveMarketingConsent(
  client: SupabaseClient,
  value: boolean,
) {
  return client.rpc('set_marketing_consent', {
    p_consented: z.boolean().parse(value),
  })
}
