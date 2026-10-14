import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
const slug = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)
export const classification = z.object({
  id: z.guid(),
  version: z.number().int().nonnegative(),
  itemType: slug.nullable(),
  assortment: z.uuid().nullable(),
})
export const classificationCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('group'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(80),
  }),
  z.strictObject({
    action: z.literal('classify'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    items: z
      .array(
        z.strictObject({
          id: z.guid(),
          version: z.number().int().nonnegative(),
        }),
      )
      .min(1)
      .max(200),
    itemType: slug.nullable(),
    assortment: z.uuid().nullable(),
  }),
])
export async function readAssortmentGroups(
  client: SupabaseClient,
  tenant: string,
) {
  const r = await client
    .from('assortment_groups')
    .select('id,name')
    .eq('tenant_id', z.uuid().parse(tenant))
    .order('name')
    .limit(500)
  if (r.error) throw new Error('Unable to read assortment groups')
  return z.array(z.object({ id: z.uuid(), name: z.string() })).parse(r.data)
}
export async function readClassifications(
  client: SupabaseClient,
  tenant: string,
  items: string[],
) {
  const r = await client.rpc('item_classifications', {
    p_tenant: z.uuid().parse(tenant),
    p_items: z.array(z.guid()).max(200).parse(items),
  })
  if (r.error) throw new Error('Unable to read item classifications')
  return z.array(classification).parse(r.data)
}
export async function classifyItems(client: SupabaseClient, input: unknown) {
  const c = classificationCommand.parse(input)
  const r =
    c.action === 'group'
      ? await client.rpc('create_assortment_group', {
          p_tenant: c.tenantId,
          p_id: c.requestId,
          p_name: c.name,
        })
      : await client.rpc('classify_items', {
          p_tenant: c.tenantId,
          p_id: c.requestId,
          p_items: c.items,
          p_type: c.itemType,
          p_group: c.assortment,
        })
  if (r.error)
    throw new Error(
      [
        'FORBIDDEN',
        'INVALID_INPUT',
        'GROUP_EXISTS',
        'REQUEST_CONFLICT',
        'ITEM_CHANGED',
        'ITEM_NOT_FOUND',
        'GROUP_NOT_FOUND',
        'ITEM_TYPE_UNDEFINED',
      ].find((s) => r.error!.message === s) ?? 'REQUEST_FAILED',
    )
  if (r.data !== c.requestId) throw new Error('REQUEST_FAILED')
  return { ok: true, id: c.requestId }
}
