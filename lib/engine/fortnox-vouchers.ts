import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readCompanyInformation } from '../../extensions/fortnox/auth'
import { createVoucher } from '../../extensions/fortnox/vouchers'
import { fortnoxAccessToken } from './fortnox-connection'
import { payoutSource } from './accounting'

// Sending one recorded export to Fortnox as one voucher. The database opens
// the send (one live send per export), the application talks to Fortnox,
// the database closes the send as sent or failed. A sent export cannot be
// sent again; only a proven preflight failure can be retried.
const voucherLine = z.object({
  key: z.string(),
  account: z.string(),
  side: z.enum(['debit', 'credit']),
  amountOre: z.number().int().nonnegative(),
})
export const fortnoxPreview = z.object({
  baselineSendId: z.uuid().nullable(),
  baselineCloseVersion: z.number().int().nonnegative(),
  blockedReason: z.string(),
  lines: z.array(voucherLine),
  debitOre: z.number().int(),
  creditOre: z.number().int(),
  payoutSources: z.array(payoutSource),
})
export type FortnoxPreview = z.infer<typeof fortnoxPreview>

export async function previewFortnoxSend(
  client: SupabaseClient,
  tenant: string,
  exportId: string,
) {
  const result = await client.rpc('preview_fortnox_send', {
    p_tenant: z.uuid().parse(tenant),
    p_export: z.uuid().parse(exportId),
  })
  if (result.error) throw new Error(result.error.message)
  return fortnoxPreview.parse(result.data)
}
export const sendState = z.object({
  dispatchAllowed: z.boolean().default(false),
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

export const confirmedFortnoxVoucher = z.strictObject({
  tenantId: z.uuid(),
  sendId: z.uuid(),
  voucherSeries: z.string().trim().min(1).max(10),
  voucherNumber: z.number().int().positive().max(2147483647),
  financialYear: z.number().int().positive().max(2147483647),
  evidence: z.string().trim().min(1).max(500),
})

export async function confirmFortnoxVoucher(
  client: SupabaseClient,
  input: z.input<typeof confirmedFortnoxVoucher>,
) {
  const value = confirmedFortnoxVoucher.parse(input)
  const result = await client.rpc('reconcile_fortnox_send', {
    p_tenant: value.tenantId,
    p_send_id: value.sendId,
    p_outcome: 'confirmed_sent',
    p_voucher_series: value.voucherSeries,
    p_voucher_number: value.voucherNumber,
    p_financial_year: value.financialYear,
    p_evidence: value.evidence,
  })
  if (result.error) throw new Error(result.error.message)
  return sendState.parse(result.data)
}

const sendRow = z.object({
  id: z.uuid(),
  export_id: z.uuid(),
  database_number: z.string(),
  status: z.enum(['pending', 'sent', 'failed']),
  voucher_series: z.string(),
  voucher_number: z.number().int().nullable(),
  financial_year: z.number().int().nullable(),
  error_code: z.string(),
  detail: z.string(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  delta_voucher: z.array(voucherLine).nullable().optional(),
  baseline_send_id: z.uuid().nullable().optional(),
  payout_sources: z.array(payoutSource).optional(),
})
export type FortnoxSendRow = z.infer<typeof sendRow>

/** Newest send per export, newest first. RLS scopes the read. */
export async function readFortnoxSends(
  client: SupabaseClient,
  tenantInput: string,
  exportInput?: string,
) {
  // The scoped read derives delivery sources from immutable baseline/target
  // closes and filters the exact export before applying the limit.
  const r = await client.rpc('fortnox_sends_page', {
    p_tenant: z.uuid().parse(tenantInput),
    p_export: exportInput ? z.uuid().parse(exportInput) : null,
  })
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
  expectedBaseline: string | null = null,
): Promise<FortnoxSendState> {
  const tenantId = z.uuid().parse(tenantInput)
  const begin = await client.rpc('begin_fortnox_send', {
    p_tenant: tenantId,
    p_id: z.uuid().parse(requestInput),
    p_export: z.uuid().parse(exportInput),
    p_expected_baseline: z.uuid().nullable().parse(expectedBaseline),
  })
  if (begin.error) throw new Error(begin.error.message)
  const opened = sendState.parse(begin.data)
  if (opened.status !== 'pending') return opened
  if (!opened.dispatchAllowed) throw new Error('FORTNOX_SEND_IN_PROGRESS')
  let attempted = false
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
    attempted = true
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
    try {
      await complete(client, tenantId, opened.sendId, {
        status: 'failed',
        error: attempted
          ? 'FORTNOX_OUTCOME_UNKNOWN'
          : 'FORTNOX_PREFLIGHT_FAILED',
        detail: '',
      })
    } catch {}
    if (attempted) throw new Error('FORTNOX_OUTCOME_UNKNOWN')
    throw e
  }
}
