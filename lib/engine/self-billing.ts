import { z } from 'zod'
import { businessDetails } from './seller-business'
import { storeCurrencies } from '../platform/currencies'
import { locales, type Dictionary } from '../i18n'

const ore = z.number().int().safe()
export const selfBilling = z.object({
  version: z.literal(1),
  language: z.enum(locales).optional(),
  currency: z.enum(storeCurrencies),
  supplier: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    addressLine1: z.string(),
    addressLine2: z.string(),
    postalCode: z.string(),
    city: z.string(),
    country: z.string(),
    business: businessDetails,
  }),
  buyer: z.object({
    name: z.string(),
    address: z.object({
      street: z.string().optional(),
      postalCode: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
    }),
    contact: z.object({
      email: z.string().optional(),
      phone: z.string().optional(),
    }),
  }),
  lines: z.array(
    z.object({
      grossOre: ore,
      netOre: ore,
      vatOre: ore,
      rateBp: z.number().int().nullable(),
      mode: z.string(),
      vatNumber: z.string(),
      saleLineId: z.uuid(),
      referenceId: z.uuid(),
      kind: z.enum(['credit_sale', 'credit_reversal']),
      description: z.string().nullable(),
      occurredAt: z.string(),
    }),
  ),
})
export type SelfBilling = z.infer<typeof selfBilling>
export function statementTitle(
  s: { kind: string; self_billing?: unknown; is_self_billing?: boolean },
  d: Dictionary['statements'],
) {
  return s.self_billing || s.is_self_billing
    ? s.kind === 'credit_note'
      ? d.selfBillingCredit
      : d.selfBilling
    : s.kind === 'credit_note'
      ? d.creditNote
      : d.statement
}
