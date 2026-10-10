import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { locales } from '../i18n'

export const sellerAgreementState = z.object({
  agreement: z
    .object({
      id: z.uuid(),
      version: z.number().int().positive(),
      title: z.string(),
      body: z.string(),
      language: z.enum(locales),
    })
    .nullable(),
  acceptance: z
    .object({
      id: z.uuid(),
      at: z.string(),
      source: z.enum(['staff_recorded', 'seller_portal']),
    })
    .nullable(),
})
export const sellerAgreementCommand = z.strictObject({
  tenantId: z.uuid(),
  sellerId: z.uuid(),
  requestId: z.uuid(),
  agreementId: z.uuid(),
})
export const sellerAgreementArchive = sellerAgreementState.extend({
  current: z.boolean(),
  total: z.number().int().nonnegative(),
  history: z
    .array(
      z.object({
        id: z.uuid(),
        version: z.number().int().positive(),
        title: z.string(),
        at: z.string(),
        source: z.enum(['staff_recorded', 'seller_portal']),
      }),
    )
    .max(20),
})
export async function readMySellerAgreementArchive(
  client: SupabaseClient,
  tenant: string,
  seller: string,
  version: string | null,
  page: number,
) {
  const result = await client.rpc('my_seller_agreement_archive', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
    p_version: z.uuid().nullable().parse(version),
    p_offset: (z.number().int().min(1).max(100000).parse(page) - 1) * 20,
  })
  if (result.error) throw new Error('Unable to read seller agreement history')
  return sellerAgreementArchive.parse(result.data)
}
export async function readMySellerAgreement(
  client: SupabaseClient,
  tenant: string,
  seller: string,
) {
  const result = await client.rpc('my_seller_agreement', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
  })
  if (result.error) throw new Error('Unable to read seller agreement')
  return sellerAgreementState.parse(result.data)
}
export async function acceptMySellerAgreement(
  client: SupabaseClient,
  input: unknown,
) {
  const command = sellerAgreementCommand.parse(input)
  return client.rpc('accept_my_seller_agreement', {
    p_tenant: command.tenantId,
    p_seller: command.sellerId,
    p_id: command.requestId,
    p_agreement: command.agreementId,
  })
}
