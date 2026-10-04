import { z } from 'zod'
export const itemPhotoState = z.object({
  itemId: z.guid(),
  revision: z.number().int().nonnegative(),
  defaultPhotoId: z.guid().nullable(),
  photos: z
    .array(
      z.object({
        id: z.guid(),
        bucket: z.enum(['item-photos', 'reception-photos']),
        path: z.string(),
      }),
    )
    .max(20),
})
export type ItemPhotoState = z.infer<typeof itemPhotoState>
export const itemPhotoCommand = z.object({
  tenantId: z.uuid(),
  itemId: z.guid(),
  requestId: z.uuid(),
  photoId: z.guid(),
  expected: z.coerce.number().int().min(0).max(2147483646),
  action: z.enum(['add', 'default', 'remove']),
})
