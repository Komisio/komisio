import { z } from 'zod'

export const sellerType = z.enum(['private', 'business'])
export const businessDetails = z.strictObject({
  companyName: z.string().trim().max(160).default(''),
  organisationNumber: z.string().trim().max(80).default(''),
  vatNumber: z.string().trim().max(80).default(''),
  vatRegistered: z.boolean().default(false),
  contactPerson: z.string().trim().max(120).default(''),
  billingAddress: z.string().trim().max(500).default(''),
  invoiceEmail: z.union([z.literal(''), z.email().max(254)]).default(''),
  invoiceReference: z.string().trim().max(120).default(''),
})
export type BusinessDetails = z.infer<typeof businessDetails>

/** Staff forms only. Public applications always register private sellers. */
export function businessFromFields(fields: FormData) {
  const type = fields.get('sellerType') === 'business' ? 'business' : 'private'
  return {
    sellerType: type,
    ...(type === 'business'
      ? {
          business: Object.fromEntries(
            Object.keys(businessDetails.shape).map((key) => [
              key,
              key === 'vatRegistered'
                ? fields.get(key) === 'on'
                : String(fields.get(key) ?? '').trim(),
            ]),
          ),
        }
      : {}),
  }
}
