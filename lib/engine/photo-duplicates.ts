import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Exact photo repeats (docs/DUPLICATE-CHECK.md, step one): photos of one
// reception whose bytes were uploaded before in another reception of the
// store, with where they were seen. Read only; any member.
export const photoDuplicates = z.object({
  photos: z
    .array(
      z.object({
        photoId: z.uuid(),
        seen: z
          .array(
            z.object({
              sessionId: z.uuid(),
              photoId: z.uuid(),
              seenAt: z.string(),
              sellerId: z.uuid(),
              sellerName: z.string(),
            }),
          )
          .max(5),
      }),
    )
    .max(20),
})
export type PhotoDuplicates = z.infer<typeof photoDuplicates>

export async function readPhotoDuplicates(
  client: SupabaseClient,
  tenantInput: string,
  sessionInput: string,
) {
  const r = await client.rpc('photo_duplicates', {
    p_tenant: z.uuid().parse(tenantInput),
    p_session: z.uuid().parse(sessionInput),
  })
  // Until the migration reaches the database there is nothing to show.
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return photoDuplicates.parse(r.data)
}
