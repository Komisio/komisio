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
        target_id: z.uuid().nullable(),
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
  const result = await client.rpc('store_activity', {
    p_tenant: z.uuid().parse(tenant),
    p_from: q.from || null,
    p_to: q.to || null,
    p_actor: q.actor || null,
    p_action: q.kind || null,
    p_offset: (q.page - 1) * 25,
    p_limit: 25,
  })
  if (result.error) throw new Error('Unable to read store activity')
  return activityResult.parse(result.data)
}
