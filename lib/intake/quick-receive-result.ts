import { z } from 'zod'
import { storeCurrencies } from '../platform/currencies'

export const acceptedReceptionPrice = z.object({
  amount: z
    .string()
    .regex(/^(?:0|[1-9]\d{0,5})\.\d{2}$/)
    .refine((v) => v !== '0.00'),
  currency: z.enum(storeCurrencies),
})

/**
 * What a completed quick reception reports. Shared by the route (parsing the
 * engine reply) and the browser (parsing the route reply): a 200 whose body
 * does not carry these fields is not a confirmed reception, because the
 * item may already exist while only the reply was damaged. Browser-safe: no
 * server imports here.
 */
export const quickReceiveResult = z.object({
  itemId: z.guid(),
  reference: z.string(),
  sessionId: z.guid(),
  garmentId: z.guid(),
  reviewVersion: z.number().int(),
  // Older route replies still confirm acceptance; never invent their price.
  price: acceptedReceptionPrice.optional(),
})
export type QuickReceiveResult = z.infer<typeof quickReceiveResult>
