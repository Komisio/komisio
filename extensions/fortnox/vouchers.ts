import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'

// The one write Komisio makes to Fortnox: a voucher from recorded export
// lines. Amounts arrive as integer öre and leave as kronor with two
// decimals, the unit Fortnox expects; the account numbers are the tenant's.
const API_URL = 'https://api.fortnox.se/3'
export const VOUCHER_SERIES = 'A'

export type VoucherInput = {
  transactionDate: string
  description: string
  lines: { account: string; side: 'debit' | 'credit'; amountOre: number }[]
}

export function kronor(ore: number) {
  if (!Number.isSafeInteger(ore) || ore < 0) throw new Error('INVALID_INPUT')
  return Number((ore / 100).toFixed(2))
}

export function voucherBody(input: VoucherInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate))
    throw new Error('INVALID_INPUT')
  if (input.lines.length === 0) throw new Error('INVALID_INPUT')
  return {
    Voucher: {
      VoucherSeries: VOUCHER_SERIES,
      TransactionDate: input.transactionDate,
      Description: input.description.slice(0, 200),
      VoucherRows: input.lines.map((l) => {
        if (!/^\d{4}$/.test(l.account)) throw new Error('INVALID_INPUT')
        return {
          Account: Number(l.account),
          Debit: l.side === 'debit' ? kronor(l.amountOre) : 0,
          Credit: l.side === 'credit' ? kronor(l.amountOre) : 0,
        }
      }),
    },
  }
}

export const createdVoucher = z.object({
  VoucherSeries: z.string().min(1).max(10),
  VoucherNumber: z.number().int().positive(),
  Year: z.number().int().positive().optional(),
})
export type CreatedVoucher = z.infer<typeof createdVoucher>

const errorInformation = z.object({
  ErrorInformation: z
    .object({
      Code: z.union([z.number(), z.string()]).optional(),
      Message: z.string().max(500).optional(),
      message: z.string().max(500).optional(),
    })
    .optional(),
})

export class FortnoxRejected extends Error {
  detail: string
  constructor(detail: string) {
    super('FORTNOX_VOUCHER_REJECTED')
    this.detail = detail
  }
}

export async function createVoucher(
  accessToken: string,
  input: VoucherInput,
  http: typeof fetch = globalThis.fetch,
): Promise<CreatedVoucher> {
  if (!accessToken || /[\r\n]/.test(accessToken))
    throw new Error('FORTNOX_AUTH_REQUIRED')
  const body = voucherBody(input)
  let response: Response
  try {
    response = await http(`${API_URL}/vouchers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('FORTNOX_CONNECTION_FAILED')
  }
  if (response.status === 429) throw new Error('FORTNOX_RATE_LIMITED')
  if ([401, 403].includes(response.status))
    throw new Error('FORTNOX_AUTH_REQUIRED')
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const info = errorInformation.parse(await boundedJson(response, 65536))
      detail = (
        info.ErrorInformation?.Message ??
        info.ErrorInformation?.message ??
        detail
      ).slice(0, 500)
    } catch {
      // The status alone is the detail.
    }
    throw new FortnoxRejected(detail)
  }
  const parsed = z
    .object({ Voucher: createdVoucher })
    .parse(await boundedJson(response, 65536))
  return parsed.Voucher
}
