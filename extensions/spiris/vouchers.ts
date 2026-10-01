import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'
import { spirisApiUrl, type SpirisEnvironment } from './auth'

// The one write Komisio makes to Spiris: a voucher from recorded export lines.
// Amounts arrive as integer öre and leave as the company currency with two
// decimals; the account numbers are the tenant's. Spiris picks the number
// series itself and answers with the voucher id and its number in the series.
export type VoucherInput = {
  transactionDate: string
  description: string
  lines: { account: string; side: 'debit' | 'credit'; amountOre: number }[]
}

export function major(ore: number) {
  if (!Number.isSafeInteger(ore) || ore < 0) throw new Error('INVALID_INPUT')
  return Number((ore / 100).toFixed(2))
}

export function voucherBody(input: VoucherInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate))
    throw new Error('INVALID_INPUT')
  if (input.lines.length === 0) throw new Error('INVALID_INPUT')
  return {
    VoucherDate: input.transactionDate,
    VoucherText: input.description.slice(0, 100),
    Rows: input.lines.map((l) => {
      if (!/^\d{4}$/.test(l.account)) throw new Error('INVALID_INPUT')
      return {
        AccountNumber: Number(l.account),
        DebitAmount: l.side === 'debit' ? major(l.amountOre) : 0,
        CreditAmount: l.side === 'credit' ? major(l.amountOre) : 0,
      }
    }),
  }
}

export const createdVoucher = z.object({
  Id: z.string().min(1).max(80),
  NumberAndNumberSeries: z.string().trim().min(1).max(40),
  NumberSeries: z.string().max(10).nullable().optional(),
})
export type CreatedVoucher = z.infer<typeof createdVoucher>

const errorInformation = z.object({
  DeveloperErrorMessage: z.string().max(500).optional(),
  Message: z.string().max(500).optional(),
  ErrorCode: z.union([z.number(), z.string()]).optional(),
})

export class SpirisRejected extends Error {
  detail: string
  constructor(detail: string) {
    super('SPIRIS_VOUCHER_REJECTED')
    this.detail = detail
  }
}

export async function createVoucher(
  env: SpirisEnvironment,
  accessToken: string,
  input: VoucherInput,
  http: typeof fetch = globalThis.fetch,
): Promise<CreatedVoucher> {
  if (!accessToken || /[\r\n]/.test(accessToken))
    throw new Error('SPIRIS_AUTH_REQUIRED')
  const body = voucherBody(input)
  let response: Response
  try {
    response = await http(`${spirisApiUrl(env)}/vouchers`, {
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
    throw new Error('SPIRIS_CONNECTION_FAILED')
  }
  if (response.status === 429) throw new Error('SPIRIS_RATE_LIMITED')
  if ([401, 403].includes(response.status))
    throw new Error('SPIRIS_AUTH_REQUIRED')
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const info = errorInformation.parse(await boundedJson(response, 65536))
      detail = (info.DeveloperErrorMessage ?? info.Message ?? detail).slice(
        0,
        500,
      )
    } catch {
      // The status alone is the detail.
    }
    throw new SpirisRejected(detail)
  }
  return createdVoucher.parse(await boundedJson(response, 65536))
}
