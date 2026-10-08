import { z } from 'zod'

export const priceAmount = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})\.\d{2}$/)
  .refine((v) => v !== '0.00')
export function publicSourceUrl(value: string) {
  try {
    const u = new URL(value)
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(u.hostname) &&
      !/\.(?:localhost|local|internal|test|invalid)$/i.test(u.hostname)
    )
  } catch {
    return false
  }
}
export const externalSource = z.strictObject({
  url: z.string().max(2000).refine(publicSourceUrl),
  title: z.string().trim().min(1).max(160),
  amount: priceAmount,
  condition: z.string().trim().min(1).max(300),
  status: z.enum(['asking', 'sold']),
  soldAt: z.iso.datetime().nullable(),
  country: z.literal('SE'),
  currency: z.literal('SEK'),
  priceBasis: z.literal('item_only'),
})
export const externalComparison = z.strictObject({
  from: priceAmount,
  to: priceAmount,
  basis: z.enum(['asking', 'sold']),
  observedAt: z.iso.datetime(),
  sources: z.array(externalSource).min(2).max(3),
})
export type ExternalComparison = z.infer<typeof externalComparison>
