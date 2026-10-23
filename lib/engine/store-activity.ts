import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const activityQuery = z
  .object({
    from: z.union([z.iso.date(), z.literal('')]).default(''),
    to: z.union([z.iso.date(), z.literal('')]).default(''),
    actor: z.union([z.uuid(), z.literal('')]).default(''),
    kind: z.string().max(120).default(''),
    page: z.coerce.number().int().min(1).max(40001).default(1),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to)

export const activityResult = z.object({
  total: z.number().int().nonnegative(),
  rows: z
    .array(
      z.object({
        id: z.string().regex(/^\d+$/),
        actor_id: z.uuid().nullable(),
        actor_name: z.string().nullable(),
        actor_state: z.enum(['system', 'former', 'member']),
        action: z.string(),
        // Audit targets include md5(...)::uuid references from integrations.
        // PostgreSQL UUIDs need not carry RFC version/variant bits.
        target_id: z
          .string()
          .regex(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          )
          .nullable(),
        occurred_at: z.string(),
      }),
    )
    .max(25),
  actors: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().nullable(),
        former: z.boolean(),
      }),
    )
    .max(100),
})

export async function readStoreActivity(
  client: SupabaseClient,
  tenant: string,
  query: z.infer<typeof activityQuery>,
) {
  const q = activityQuery.parse(query)
  const args = {
    p_tenant: z.uuid().parse(tenant),
    p_from: q.from || null,
    p_to: q.to || null,
    p_actor: q.actor || null,
    p_action: q.kind || null,
    p_offset: (q.page - 1) * 25,
    p_limit: 25,
  }
  const failed = (reason: 'rpc' | 'response' | 'transport') => {
    // Never log returned event data, names, IDs or database error details.
    console.error('Store activity read failed', { reason })
    return { ok: false as const }
  }
  try {
    const result = await client.rpc('store_activity', args)
    if (result.error) return failed('rpc')
    const parsed = activityResult.safeParse(result.data)
    if (!parsed.success) return failed('response')
    return { ok: true as const, data: parsed.data }
  } catch {
    return failed('transport')
  }
}
