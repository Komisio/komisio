import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { shopifyAccessToken } from './shopify-connection'
import { listLocations } from '../../extensions/shopify/products'
import { listPublications } from '../../extensions/shopify/publications'

import { shopifySettings } from '../../extensions/shopify/settings'
export { shopifySettings } from '../../extensions/shopify/settings'
export const shopifySettingsStatus = z.object({
  settings: shopifySettings.nullable(),
  revision: z.string().regex(/^\d+$/),
  locked: z.boolean(),
})
export type ShopifySettings = z.infer<typeof shopifySettings>
export type ShopifySettingsStatus = z.infer<typeof shopifySettingsStatus>

export async function readShopifySettings(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('shopify_sync_settings', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error) throw new Error('SHOPIFY_SETTINGS_UNAVAILABLE')
  return shopifySettingsStatus.parse(r.data)
}

export async function shopifySetupOptions(
  client: SupabaseClient,
  tenantId: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  const role = await client.rpc('tenant_role', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (role.error || !['owner', 'admin'].includes(role.data ?? ''))
    throw new Error('FORBIDDEN')
  const { accessToken, row } = await shopifyAccessToken(
    client,
    tenantId,
    source,
    http,
  )
  const [locations, publications] = await Promise.all([
    listLocations(row.shopDomain, accessToken, http),
    listPublications(row.shopDomain, accessToken, http),
  ])
  return {
    shop: row.shopDomain,
    locations: locations.filter((l) => l.isActive),
    publications,
  }
}

export async function saveShopifySettings(
  client: SupabaseClient,
  tenantId: string,
  input: unknown,
  revision: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  const settings = shopifySettings.parse(input)
  z.string().regex(/^\d+$/).parse(revision)
  const options = await shopifySetupOptions(client, tenantId, source, http)
  const location = options.locations.find((l) => l.id === settings.locationId)
  if (!location) throw new Error('SHOPIFY_NO_LOCATION')
  for (const id of [settings.webPublicationId, settings.posPublicationId]) {
    if (id && !options.publications.some((p) => p.id === id))
      throw new Error('SHOPIFY_PUBLICATION_INVALID')
  }
  const r = await client.rpc('save_shopify_sync_settings', {
    p_tenant: tenantId,
    p_shop: options.shop,
    p_revision: revision,
    p_settings: { ...settings, locationName: location.name },
  })
  if (r.error) throw new Error(r.error.message)
  return shopifySettingsStatus.parse(r.data)
}
