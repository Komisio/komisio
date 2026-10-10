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
      translationId: z.uuid().nullable().optional(),
    })
    .nullable(),
  acceptance: z
    .object({
      id: z.uuid(),
      at: z.string(),
      source: z.enum(['staff_recorded', 'seller_portal']),
      translationId: z.uuid().nullable().optional(),
      language: z.enum(locales).optional(),
    })
    .nullable(),
})
export const sellerAgreementCommand = z.strictObject({
  tenantId: z.uuid(),
  sellerId: z.uuid(),
  requestId: z.uuid(),
  agreementId: z.uuid(),
  translationId: z.uuid().nullable().optional(),
})
export const sellerAgreementArchive = sellerAgreementState.extend({
  current: z.boolean(),
  languages: z
    .array(z.object({ id: z.uuid(), language: z.enum(locales) }))
    .max(8)
    .default([]),
  total: z.number().int().nonnegative(),
  history: z
    .array(
      z.object({
        id: z.uuid(),
        version: z.number().int().positive(),
        title: z.string(),
        at: z.string(),
        source: z.enum(['staff_recorded', 'seller_portal']),
        translationId: z.uuid().nullable().optional(),
        language: z.enum(locales).optional(),
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
  text: string | null = null,
) {
  const result = await client.rpc('my_seller_agreement_text', {
    p_text: z.uuid().nullable().parse(text),
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
  return client.rpc(
    command.translationId
      ? 'accept_my_seller_agreement_text'
      : 'accept_my_seller_agreement',
    {
      ...(command.translationId
        ? { p_translation: command.translationId }
        : {}),
      p_tenant: command.tenantId,
      p_seller: command.sellerId,
      p_id: command.requestId,
      p_agreement: command.agreementId,
    },
  )
}
