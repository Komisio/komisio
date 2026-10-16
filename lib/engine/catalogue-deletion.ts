import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const catalogueDeleteInput = z
  .strictObject({
    tenantId: z.uuid(),
    kind: z.enum(['category', 'type', 'attribute', 'group']),
    key: z.string().min(1).max(40),
  })
  .refine((v) =>
    v.kind === 'category' || v.kind === 'group'
      ? z.uuid().safeParse(v.key).success
      : /^[a-z][a-z0-9_]{0,39}$/.test(v.key),
  )
export const catalogueUsage = z.partialRecord(
  z.enum([
    'items',
    'profiles',
    'history',
    'receptions',
    'proposals',
    'settings',
  ]),
  z.number().int().positive(),
)
export const catalogueDeleteResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    kind: z.enum(['category', 'type', 'attribute', 'group']),
    key: z.string(),
  }),
  z.object({ ok: z.literal(false), usage: catalogueUsage }),
])
export async function deleteCatalogueRecord(
  client: SupabaseClient,
  input: unknown,
) {
  const c = catalogueDeleteInput.parse(input)
  const { data, error } = await client.rpc('delete_catalogue_record', {
    p_tenant: c.tenantId,
    p_kind: c.kind,
    p_key: c.key,
  })
  if (error)
    throw new Error(
      ['FORBIDDEN', 'AUTH_REQUIRED', 'INVALID_INPUT'].includes(error.message)
        ? error.message
        : 'REQUEST_FAILED',
    )
  const result = catalogueDeleteResult.parse(data)
  if (result.ok && (result.kind !== c.kind || result.key !== c.key))
    throw new Error('REQUEST_FAILED')
  return result
}
