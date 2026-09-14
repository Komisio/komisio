import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readCompanyInformation } from '../../extensions/fortnox/auth'
import {
  createVoucher,
  FortnoxRejected,
} from '../../extensions/fortnox/vouchers'
import { fortnoxAccessToken, fortnoxErrorCode } from './fortnox-connection'

// Sending one recorded export to Fortnox as one voucher. The database opens
// the send (one live send per export), the application talks to Fortnox,
// the database closes the send as sent or failed. A sent export cannot be
// sent again; a failed one can.
const voucherLine = z.object({
  key: z.string(),
  account: z.string(),
  side: z.enum(['debit', 'credit']),
  amountOre: z.number().int().nonnegative(),
})
export const sendState = z.object({
  sendId: z.uuid(),
  exportId: z.uuid(),
  status: z.enum(['pending', 'sent', 'failed']),
  databaseNumber: z.string(),
  voucherSeries: z.string(),
  voucherNumber: z.number().int().nullable(),
  financialYear: z.number().int().nullable(),
  errorCode: z.string(),
  detail: z.string(),
  closeDate: z.string(),
  closeVersion: z.number().int(),
  lines: z.array(voucherLine),
  debitOre: z.number().int(),
  creditOre: z.number().int(),
})
export type FortnoxSendState = z.infer<typeof sendState>

const sendRow = z.object({
  id: z.uuid(),
  export_id: z.uuid(),
  status: z.enum(['pending', 'sent', 'failed']),
  voucher_series: z.string(),
  voucher_number: z.number().int().nullable(),
  financial_year: z.number().int().nullable(),
  error_code: z.string(),
  detail: z.string(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
})
export type FortnoxSendRow = z.infer<typeof sendRow>

/** Newest send per export, newest first. RLS scopes the read. */
export async function readFortnoxSends(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client
    .from('fortnox_voucher_sends')
    .select(
      'id,export_id,status,voucher_series,voucher_number,financial_year,error_code,detail,created_at,completed_at',
    )
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .order('created_at', { ascending: false })
    .limit(200)
  if (r.error) throw new Error('Unable to read Fortnox sends')
  const latest = new Map<string, FortnoxSendRow>()
  for (const row of z.array(sendRow).parse(r.data))
    if (!latest.has(row.export_id)) latest.set(row.export_id, row)
  return latest
}

async function complete(
  client: SupabaseClient,
  tenantId: string,
  sendId: string,
  outcome:
    | { status: 'sent'; series: string; number: number; year: number | null }
    | { status: 'failed'; error: string; detail: string },
) {
  const r = await client.rpc('complete_fortnox_send', {
    p_tenant: tenantId,
    p_id: sendId,
    p_status: outcome.status,
    p_series: outcome.status === 'sent' ? outcome.series : '',
    p_number: outcome.status === 'sent' ? outcome.number : null,
    p_year: outcome.status === 'sent' ? outcome.year : null,
    p_error: outcome.status === 'failed' ? outcome.error : '',
    p_detail: outcome.status === 'failed' ? outcome.detail : '',
  })
  if (r.error) throw new Error(r.error.message)
  return sendState.parse(r.data)
}

/**
 * Sends one export. Replay by request id returns the recorded outcome. The
 * company answering for the stored token must be the database the
 * connection was made with; otherwise the send fails without a voucher.
 */
export async function sendExportToFortnox(
  client: SupabaseClient,
  tenantInput: string,
  exportInput: string,
  requestInput: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
): Promise<FortnoxSendState> {
  const tenantId = z.uuid().parse(tenantInput)
  const begin = await client.rpc('begin_fortnox_send', {
    p_tenant: tenantId,
    p_id: z.uuid().parse(requestInput),
    p_export: z.uuid().parse(exportInput),
  })
  if (begin.error) throw new Error(begin.error.message)
  const opened = sendState.parse(begin.data)
  if (opened.status !== 'pending') return opened
  try {
    const { accessToken } = await fortnoxAccessToken(
      client,
      tenantId,
      source,
      http,
    )
    const company = await readCompanyInformation(accessToken, http)
    if (company.DatabaseNumber !== opened.databaseNumber)
      throw new Error('FORTNOX_WRONG_COMPANY')
    const voucher = await createVoucher(
      accessToken,
      {
        transactionDate: opened.closeDate,
        description: `Dagsavslut ${opened.closeDate} v${opened.closeVersion}`,
        lines: opened.lines,
      },
      http,
    )
    return await complete(client, tenantId, opened.sendId, {
      status: 'sent',
      series: voucher.VoucherSeries,
      number: voucher.VoucherNumber,
      year: voucher.Year ?? null,
    })
  } catch (e) {
    const code = fortnoxErrorCode(e instanceof Error ? e.message : '')
    const detail = e instanceof FortnoxRejected ? e.detail : ''
    await complete(client, tenantId, opened.sendId, {
      status: 'failed',
      error: code,
      detail,
    })
    throw e
  }
}
