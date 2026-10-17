import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const agreementUsage = z.partialRecord(
  z.enum(['sellers', 'receipts', 'reviews', 'items', 'sales']),
  z.number().int().positive(),
)
export type AgreementUsage = z.infer<typeof agreementUsage>
export const agreementDeleteInput = z.strictObject({
  tenantId: z.uuid(),
  agreementId: z.uuid(),
})
export const agreementDeleteResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), agreementId: z.uuid() }),
  z.object({ ok: z.literal(false), usage: agreementUsage }),
])

const linkMap = z.record(z.string(), agreementUsage)

export function agreementLinkSummary(
  usage: AgreementUsage,
  labels: Record<keyof AgreementUsage, string>,
) {
  return Object.entries(usage)
    .map(([key, count]) => `${labels[key as keyof AgreementUsage]}: ${count}`)
    .join(' · ')
}

export async function readSellerAgreementLinks(
  client: SupabaseClient,
  tenant: string,
  agreements: string[],
) {
  if (agreements.length === 0) return {}
  const ids = z.array(z.uuid()).max(100).parse(agreements)
  const result = await client.rpc('seller_agreement_links', {
    p_tenant: z.uuid().parse(tenant),
    p_agreements: ids,
  })
  if (result.error) throw new Error('Unable to read agreement links')
  const links = linkMap.parse(result.data)
  for (const id of Object.keys(links)) z.uuid().parse(id)
  return links
}

export async function deleteUnusedSellerAgreement(
  client: SupabaseClient,
  input: unknown,
) {
  const command = agreementDeleteInput.parse(input)
  const { data, error } = await client.rpc('delete_unused_seller_agreement', {
    p_tenant: command.tenantId,
    p_agreement: command.agreementId,
  })
  if (error)
    throw new Error(
      ['FORBIDDEN', 'AUTH_REQUIRED', 'INVALID_INPUT'].includes(error.message)
        ? error.message
        : 'REQUEST_FAILED',
    )
  const result = agreementDeleteResult.parse(data)
  if (result.ok && result.agreementId !== command.agreementId)
    throw new Error('REQUEST_FAILED')
  return result
}
