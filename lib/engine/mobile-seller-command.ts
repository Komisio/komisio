import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { executeSellerPortal, sellerPortalCommand } from './seller-portal'
import { bankCommand, executeBankCommand } from './seller-bank'
import {
  acceptMySellerAgreement,
  sellerAgreementCommand,
} from './seller-agreement'

// Reuse the strict existing command contracts; only the seller operations enter v1.
export const mobileSellerCommand = z.discriminatedUnion('action', [
  sellerPortalCommand.options[0],
  sellerPortalCommand.options[0].extend({
    action: z.literal('requestCentralPayout'),
    destination: z.discriminatedUnion('method', [
      z.strictObject({
        method: z.literal('swish'),
        phone: z.string().regex(/^\+467[023689]\d{7}$/),
      }),
      z.strictObject({ method: z.literal('bank'), bankVersionId: z.uuid() }),
    ]),
  }),
  bankCommand.options[0].extend({ action: z.literal('saveBank') }),
  sellerAgreementCommand.extend({ action: z.literal('acceptAgreement') }),
])

export async function executeMobileSellerCommand(
  client: SupabaseClient,
  input: unknown,
) {
  const command = mobileSellerCommand.parse(input)
  if (command.action === 'saveBank')
    return executeBankCommand(client, { ...command, action: 'save' })
  if (command.action === 'requestCentralPayout') {
    const { data, error } = await client.rpc('request_central_payout', {
      p_tenant: command.tenantId,
      p_id: command.requestId,
      p_seller: command.sellerId,
      p_amount_ore: command.amountOre,
      p_destination: command.destination,
    })
    if (error) throw error
    if (data !== command.requestId) throw new Error('REQUEST_FAILED')
    return { ok: true, id: command.requestId }
  }
  const result =
    command.action === 'requestPayout'
      ? await executeSellerPortal(client, command)
      : await acceptMySellerAgreement(client, {
          tenantId: command.tenantId,
          sellerId: command.sellerId,
          requestId: command.requestId,
          agreementId: command.agreementId,
          translationId: command.translationId,
        })
  if (result.error) throw result.error
  if (
    !z.uuid().safeParse(result.data).success ||
    (command.action === 'requestPayout' && result.data !== command.requestId)
  )
    throw new Error('REQUEST_FAILED')
  // Agreement acceptance can legitimately return earlier equivalent evidence.
  return { ok: true, id: result.data as string }
}
