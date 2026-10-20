import { z } from 'zod'

/** A successful HTTP status alone does not confirm a financial operation. */
export function confirmsEconomicResult(
  action: unknown,
  body: Record<string, unknown>,
) {
  if (action === 'catalogue')
    return (
      Array.isArray(body.accounts) &&
      Array.isArray(body.journals) &&
      Array.isArray(body.vatAccounts) &&
      Number.isInteger(body.agreementNumber)
    )
  if (action === 'check') return body.checked === true
  if (action === 'disconnect') return typeof body.disconnected === 'boolean'
  if (action === 'export' || action === 'publishMap')
    return z.uuid().safeParse(body.id).success
  if (action === 'send' || action === 'confirm')
    return z
      .object({
        sendId: z.uuid(),
        exportId: z.uuid(),
        status: z.enum(['sent', 'failed', 'pending']),
        voucherNumber: z.number().int().min(0).max(999999999).nullable(),
        errorCode: z.string(),
        reason: z.string(),
        retryAfter: z.string().nullable(),
        agreementNumber: z.number().int().positive(),
        journalNumber: z.number().int().positive(),
      })
      .refine(
        (value) => (value.status === 'sent') === (value.voucherNumber !== null),
      )
      .safeParse(body).success
  return false
}
