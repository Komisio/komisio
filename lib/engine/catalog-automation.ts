import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { automationIdentity } from './automation'
import { syncProvider } from './item-sync'

export const catalogAutomation = z.object({
  provider: syncProvider,
  connectionId: z.string().min(1).max(200),
  revision: z.uuid().nullable(),
  enabled: z.boolean(),
  lastAt: z.string().nullable(),
  lastOutcome: z.enum(['running', 'complete', 'held', 'failed']).nullable(),
})
export type CatalogAutomation = z.infer<typeof catalogAutomation>
export const saveCatalogAutomationInput = catalogAutomation
  .omit({ lastAt: true, lastOutcome: true })
  .extend({ tenantId: z.uuid(), requestId: z.uuid() })
  .strict()

export async function readCatalogAutomation(
  client: SupabaseClient,
  tenantId: string,
  provider: z.infer<typeof syncProvider>,
) {
  const r = await client.rpc('catalog_automation_status', {
    p_tenant: z.uuid().parse(tenantId),
    p_provider: provider,
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('SYNC_SETTINGS_UNAVAILABLE')
  return catalogAutomation.nullable().parse(r.data)
}

export async function saveCatalogAutomation(
  client: SupabaseClient,
  input: unknown,
  env: Record<string, string | undefined> = process.env,
) {
  const c = saveCatalogAutomationInput.parse(input)
  const identity = automationIdentity(env)
  if (c.enabled && !identity) throw new Error('AUTOMATION_NOT_CONFIGURED')
  const r = await client.rpc('save_catalog_automation', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_provider: c.provider,
    p_connection: c.connectionId,
    p_previous: c.revision,
    p_enabled: c.enabled,
    p_identity_email: identity?.email ?? null,
  })
  if (r.error) throw new Error(r.error.message)
  return catalogAutomation.parse(r.data)
}

/** Application guard mirrors the database's leased-item boundary; manual roles stay unchanged. */
export async function requireCatalogItem(
  client: SupabaseClient,
  tenantId: string,
  itemId: string,
) {
  const r = await client.rpc('catalog_export_item_access', {
    p_tenant: tenantId,
    p_item: itemId,
  })
  if (r.error || r.data !== true) throw new Error('FORBIDDEN')
}
