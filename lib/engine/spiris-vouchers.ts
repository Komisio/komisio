import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { companyKey, readCompanySettings } from '../../extensions/spiris/auth'
import { createVoucher } from '../../extensions/spiris/vouchers'
import { spirisAccessToken } from './spiris-connection'

// Sending one recorded export to Spiris as one voucher. The
// database opens the send (one live send per export), the application talks
// to Spiris, the database closes the send as sent or failed. A sent export
// cannot be sent again; only a proven preflight failure can be retried, and
// an uncertain outcome is held until the owner confirms the voucher.
const voucherLine = z.object({
  key: z.string(),
  account: z.string(),
  side: z.enum(['debit', 'credit']),
  amountOre: z.number().int().nonnegative(),
})
export const sendState = z.object({
  dispatchAllowed: z.boolean().default(false),
  sendId: z.uuid(),
  exportId: z.uuid(),
  status: z.enum(['pending', 'sent', 'failed']),
  companyKey: z.string(),
  voucherId: z.string(),
  voucherNumber: z.string(),
  errorCode: z.string(),
  detail: z.string(),
  closeDate: z.string(),
  closeVersion: z.number().int(),
  lines: z.array(voucherLine),
  debitOre: z.number().int(),
  creditOre: z.number().int(),
})
export type SpirisSendState = z.infer<typeof sendState>

export const confirmedSpirisVoucher = z.strictObject({
  tenantId: z.uuid(),
  sendId: z.uuid(),
  voucherId: z.string().trim().max(80).default(''),
  voucherNumber: z.string().trim().min(1).max(40),
  evidence: z.string().trim().min(1).max(500),
})

export async function confirmSpirisVoucher(
  client: SupabaseClient,
  input: z.input<typeof confirmedSpirisVoucher>,
) {
  const value = confirmedSpirisVoucher.parse(input)
  const result = await client.rpc('reconcile_spiris_send', {
    p_tenant: value.tenantId,
    p_send_id: value.sendId,
    p_outcome: 'confirmed_sent',
    p_voucher_id: value.voucherId,
    p_voucher_number: value.voucherNumber,
    p_evidence: value.evidence,
  })
  if (result.error) throw new Error(result.error.message)
  return sendState.parse(result.data)
}

const sendRow = z.object({
  id: z.uuid(),
  export_id: z.uuid(),
  company_key: z.string(),
  status: z.enum(['pending', 'sent', 'failed']),
  voucher_id: z.string(),
  voucher_number: z.string(),
  error_code: z.string(),
  detail: z.string(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
})
export type SpirisSendRow = z.infer<typeof sendRow>

/** Newest send per export, newest first. RLS scopes the read. */
export async function readSpirisSends(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client
    .from('spiris_voucher_sends')
    .select(
      'id,export_id,company_key,status,voucher_id,voucher_number,error_code,detail,created_at,completed_at',
    )
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .order('created_at', { ascending: false })
    .limit(200)
  // Table not migrated yet (deploy gap): no sends to show.
  if (r.error?.code === 'PGRST205' || r.error?.code === '42P01')
    return new Map<string, SpirisSendRow>()
  if (r.error) throw new Error('Unable to read Spiris sends')
  const latest = new Map<string, SpirisSendRow>()
  for (const row of z.array(sendRow).parse(r.data))
    if (!latest.has(row.export_id)) latest.set(row.export_id, row)
  return latest
}

async function complete(
  client: SupabaseClient,
  tenantId: string,
  sendId: string,
  outcome:
    | { status: 'sent'; voucherId: string; voucherNumber: string }
    | { status: 'failed'; error: string; detail: string },
) {
  const r = await client.rpc('complete_spiris_send', {
    p_tenant: tenantId,
    p_id: sendId,
    p_status: outcome.status,
    p_voucher_id: outcome.status === 'sent' ? outcome.voucherId : '',
    p_voucher_number: outcome.status === 'sent' ? outcome.voucherNumber : '',
    p_error: outcome.status === 'failed' ? outcome.error : '',
    p_detail: outcome.status === 'failed' ? outcome.detail : '',
  })
  if (r.error) throw new Error(r.error.message)
  return sendState.parse(r.data)
}

/**
 * Sends one export. Replay by request id returns the recorded outcome. The
 * company answering for the stored token must be the one the connection
 * was made with; otherwise the send fails without a voucher.
 */
export async function sendExportToSpiris(
  client: SupabaseClient,
  tenantInput: string,
  exportInput: string,
  requestInput: string,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
): Promise<SpirisSendState> {
  const tenantId = z.uuid().parse(tenantInput)
  const begin = await client.rpc('begin_spiris_send', {
    p_tenant: tenantId,
    p_id: z.uuid().parse(requestInput),
    p_export: z.uuid().parse(exportInput),
  })
  if (begin.error) throw new Error(begin.error.message)
  const opened = sendState.parse(begin.data)
  if (opened.status !== 'pending') return opened
  if (!opened.dispatchAllowed) throw new Error('SPIRIS_SEND_IN_PROGRESS')
  let attempted = false
  try {
    const { env, accessToken } = await spirisAccessToken(
      client,
      tenantId,
      source,
      http,
    )
    const company = await readCompanySettings(env, accessToken, http)
    if (companyKey(company) !== opened.companyKey)
      throw new Error('SPIRIS_WRONG_COMPANY')
    attempted = true
    const voucher = await createVoucher(
      env,
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
      voucherId: voucher.Id,
      voucherNumber: voucher.NumberAndNumberSeries,
    })
  } catch (e) {
    try {
      await complete(client, tenantId, opened.sendId, {
        status: 'failed',
        error: attempted ? 'SPIRIS_OUTCOME_UNKNOWN' : 'SPIRIS_PREFLIGHT_FAILED',
        detail: '',
      })
    } catch {}
    if (attempted) throw new Error('SPIRIS_OUTCOME_UNKNOWN')
    throw e
  }
}
