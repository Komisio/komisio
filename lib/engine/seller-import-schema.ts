import { z } from 'zod'
import { businessDetails, sellerType } from './seller-business'
export const importRow = z
  .strictObject({
    sellerType: sellerType.optional(),
    business: businessDetails.optional(),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().max(254).default(''),
    phone: z.string().trim().max(40).default(''),
  })
  .refine((r) => r.business === undefined || r.sellerType === 'business')
export const importSellersPayload = z.strictObject({
  source: z.string().trim().min(1).max(200),
  rows: z.array(importRow).min(1).max(200),
})
