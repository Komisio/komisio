import { z } from 'zod'

export const sellerSearchResult = z.object({
  sellers: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        contact: z.string().nullable(),
      }),
    )
    .max(12),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
})
export type SellerChoice = z.infer<typeof sellerSearchResult>['sellers'][number]
