import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { storeCountries } from '../platform/countries'
export const bankDetails = z
  .strictObject({
    holder: z.string().trim().min(1).max(160),
    country: z.enum(storeCountries),
    kind: z.enum(['iban', 'local']),
    account: z.string().trim().min(1).max(100),
    routing: z.string().trim().max(100),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'iban') {
      const iban = d.account
      if (
        !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban) ||
        !iban.startsWith(d.country)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid IBAN',
          path: ['account'],
        })
        return
      }
      const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) =>
        String(c.charCodeAt(0) - 55),
      )
      if (BigInt(digits) % 97n !== 1n)
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid IBAN checksum',
          path: ['account'],
        })
    }
  })
export const bankVersion = z.object({
  id: z.uuid(),
  details: bankDetails,
  createdAt: z.string(),
})
export const payoutBank = z.object({
  current: bankVersion.nullable(),
  reviewed: bankVersion.nullable(),
  needsReview: z.boolean(),
})
export type BankVersion = z.infer<typeof bankVersion>
export type PayoutBank = z.infer<typeof payoutBank>
export const bankCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('save'),
    tenantId: z.uuid(),
    sellerId: z.uuid(),
    requestId: z.uuid(),
    expected: z.uuid().nullable(),
    details: bankDetails,
  }),
  z.strictObject({
    action: z.literal('review'),
    tenantId: z.uuid(),
    payoutId: z.uuid(),
    requestId: z.uuid(),
    version: z.uuid(),
  }),
])
export async function readSellerBank(
  client: SupabaseClient,
  tenant: string,
  seller: string,
) {
  const r = await client.rpc('seller_bank_details', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
  })
  if (r.error) throw new Error('Unable to read bank details')
  return bankVersion.nullable().parse(r.data)
}
export async function readPayoutBanks(
  client: SupabaseClient,
  tenant: string,
  ids: string[],
) {
  const r = await client.rpc('payout_bank_details_batch', {
    p_tenant: z.uuid().parse(tenant),
    p_payouts: z.array(z.uuid()).max(50).parse(ids),
  })
  if (r.error) throw new Error('Unable to read payout bank details')
  return z.record(z.string(), payoutBank).parse(r.data)
}
export async function executeBankCommand(
  client: SupabaseClient,
  input: unknown,
) {
  const c = bankCommand.parse(input)
  const r =
    c.action === 'save'
      ? await client.rpc('save_seller_bank_details', {
          p_tenant: c.tenantId,
          p_id: c.requestId,
          p_seller: c.sellerId,
          p_expected: c.expected,
          p_details: c.details,
        })
      : await client.rpc('review_payout_bank_details', {
          p_tenant: c.tenantId,
          p_id: c.requestId,
          p_payout: c.payoutId,
          p_version: c.version,
        })
  if (r.error)
    throw new Error(
      [
        'FORBIDDEN',
        'INVALID_INPUT',
        'REQUEST_CONFLICT',
        'BANK_DETAILS_CHANGED',
        'PAYOUT_NOT_APPROVED',
        'SELLER_CLOSED',
      ].find((code) => r.error!.message === code) ?? 'REQUEST_FAILED',
    )
  if (r.data !== c.requestId) throw new Error('REQUEST_FAILED')
  return { ok: true, id: c.requestId }
}
