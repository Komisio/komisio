import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAttributeVocabulary } from './attributes'

export const createAttributeInput = z
  .object({
    tenantId: z.uuid(),
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    locale: z.enum(['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']),
    dataType: z.enum(['text', 'number', 'choice', 'boolean']),
    unit: z.string().trim().max(16),
    choices: z.array(z.string().trim().min(1).max(120)).max(100),
  })
  .refine(
    (v) =>
      (v.dataType === 'number' || !v.unit) &&
      v.choices.length > 0 === (v.dataType === 'choice') &&
      new Set(v.choices.map((c) => c.toLocaleLowerCase(v.locale))).size ===
        v.choices.length,
  )

export async function createAttribute(
  client: SupabaseClient,
  input: z.input<typeof createAttributeInput>,
) {
  const c = createAttributeInput.parse(input)
  const labels = (name: string) => ({ en: name, [c.locale]: name })
  const { data, error } = await client.rpc('create_store_attribute', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_payload: {
      dataType: c.dataType,
      unit: c.unit,
      labels: labels(c.name),
      choices: c.choices.map((name, sort) => ({
        id: `option_${sort + 1}`,
        labels: labels(name),
        sort,
      })),
    },
  })
  if (error)
    throw new Error(
      [
        'FORBIDDEN',
        'AUTH_REQUIRED',
        'REQUEST_CONFLICT',
        'INVALID_INPUT',
      ].includes(error.message)
        ? error.message
        : 'REQUEST_FAILED',
    )
  const vocabulary = await readAttributeVocabulary(client, c.tenantId)
  const definition = vocabulary.definitions.find(
    (d) => d.slug === data && d.own && d.active,
  )
  if (!definition) throw new Error('REQUEST_FAILED')
  return { ok: true, id: c.requestId, definition }
}
