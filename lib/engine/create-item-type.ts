import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAttributeVocabulary } from './attributes'

export const createItemTypeInput = z.object({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  locale: z.enum(['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']),
  attributes: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
        expected: z.boolean(),
        sort: z.number().int().min(0).max(999),
      }),
    )
    .min(1)
    .max(100),
})

export async function createItemType(
  client: SupabaseClient,
  input: z.input<typeof createItemTypeInput>,
) {
  const c = createItemTypeInput.parse(input)
  const result = await client.rpc('create_item_type', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_name: c.name,
    p_locale: c.locale,
    p_attributes: c.attributes,
  })
  if (result.error) {
    const code = [
      'FORBIDDEN',
      'AUTH_REQUIRED',
      'REQUEST_CONFLICT',
      'INVALID_INPUT',
    ].find((c) => result.error!.message === c)
    throw new Error(code ?? 'REQUEST_FAILED')
  }
  const vocabulary = await readAttributeVocabulary(client, c.tenantId)
  const profile = vocabulary.types.find(
    (t) => t.slug === result.data && t.own && t.active,
  )
  if (!profile) throw new Error('REQUEST_FAILED')
  return { ok: true, id: c.requestId, profile }
}
