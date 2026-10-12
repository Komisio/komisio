import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncProvider } from './item-sync'

export const syncPreference = z.object({
  provider: syncProvider,
  connectionId: z.string().min(1).max(200),
  revision: z.uuid().nullable(),
  images: z.boolean(),
})
export type SyncPreference = z.infer<typeof syncPreference>
export const saveSyncPreferenceInput = syncPreference
  .extend({ tenantId: z.uuid(), requestId: z.uuid() })
  .strict()

export async function readSyncPreferences(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('integration_sync_preferences', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('SYNC_SETTINGS_UNAVAILABLE')
  return z.array(syncPreference).max(20).parse(r.data)
}

export async function saveSyncPreference(
  client: SupabaseClient,
  input: unknown,
) {
  const c = saveSyncPreferenceInput.parse(input)
  const r = await client.rpc('save_integration_sync_preference', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_provider: c.provider,
    p_connection: c.connectionId,
    p_previous: c.revision,
    p_images: c.images,
  })
  if (r.error) throw new Error(r.error.message)
  return syncPreference.parse(r.data)
}
