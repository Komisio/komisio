import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { storeScopes } from './store-api-contract'

export const inventorySecret = /^kmi_[0-9a-f]{64}$/
export const inventoryKey = z.object({
  id: z.uuid(),
  label: z.string(),
  expiresAt: z.string(),
  scopes: z.array(z.enum(storeScopes)),
})
export async function listInventoryKeys(
  client: SupabaseClient,
  tenant: string,
) {
  const r = await client.rpc('store_inventory_keys', { p_tenant: tenant })
  if (r.error) throw new Error('REQUEST_FAILED')
  return inventoryKey.array().parse(r.data)
}

export const keyCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('issue'),
    tenantId: z.uuid(),
    label: z.string().trim().min(1).max(80),
    scopes: z
      .array(z.enum(storeScopes))
      .min(1)
      .max(storeScopes.length)
      .default(['items:read']),
  }),
  z.strictObject({
    action: z.literal('revoke'),
    tenantId: z.uuid(),
    id: z.uuid(),
  }),
])

export async function manageInventoryKey(
  client: SupabaseClient,
  cmd: z.infer<typeof keyCommand>,
) {
  if (cmd.action === 'issue') {
    const r = await client.rpc('issue_store_inventory_key', {
      p_tenant: cmd.tenantId,
      p_label: cmd.label,
      p_scopes: cmd.scopes,
    })
    if (r.error)
      throw new Error(
        r.error.message === 'KEY_LIMIT' ? 'KEY_LIMIT' : 'REQUEST_FAILED',
      )
    return { secret: z.string().regex(inventorySecret).parse(r.data) }
  }
  const r = await client.rpc('revoke_store_inventory_key', {
    p_tenant: cmd.tenantId,
    p_id: cmd.id,
  })
  if (r.error) throw new Error('REQUEST_FAILED')
  return { ok: true }
}

const item = z.object({
  id: z.guid(),
  title: z.string().nullable(),
  category: z.string().nullable(),
  stage: z.string(),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
})
export async function readStoreInventory(
  client: SupabaseClient,
  token: string,
  limit: number,
  after: string | null,
  id: string | null,
) {
  const r = await client.rpc('read_store_inventory', {
    p_secret: token,
    p_limit: limit,
    p_after: after,
    p_item: id,
  })
  if (r.error)
    throw new Error(
      ['INVALID_KEY', 'RATE_LIMIT', 'INSUFFICIENT_SCOPE'].includes(
        r.error.message,
      )
        ? r.error.message
        : 'REQUEST_FAILED',
    )
  return z
    .object({ items: item.array(), nextCursor: z.guid().nullable() })
    .parse(r.data)
}
