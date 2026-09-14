import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { voucherLine } from '../accounting/sie'

// Accounting export (P2 S17): the tenant's account map and the exports made
// under it. SQL validates the map, builds voucher lines and refuses an
// unbalanced voucher; this module validates the boundary and reads.
export const accountingKeys = [
  'grossOre',
  'refundsOre',
  'commissionOre',
  'commissionVatOre',
  'sellerCreditOre',
  'creditReversedOre',
  'payoutsPaidOre',
  'mode:consignment_margin:netOre',
  'mode:consignment_margin:vatOre',
  'mode:consignment_full:netOre',
  'mode:consignment_full:vatOre',
  'mode:consignment_business:netOre',
  'mode:consignment_business:vatOre',
  'mode:store_margin:netOre',
  'mode:store_margin:vatOre',
  'mode:store_full:netOre',
  'mode:store_full:vatOre',
] as const
export type AccountingKey = (typeof accountingKeys)[number]
export const accountMapping = z.strictObject({
  account: z.string().regex(/^[1-9]\d{3}$/),
  side: z.enum(['debit', 'credit']),
})
export const accountingMapBody = z
  .record(z.string(), accountMapping)
  .refine(
    (m) =>
      Object.keys(m).every((k) =>
        (accountingKeys as readonly string[]).includes(k),
      ),
    'Unknown amount key',
  )
export type AccountingMapBody = z.infer<typeof accountingMapBody>

export const publishAccountingMapCommand = z.strictObject({
  action: z.literal('publishAccountingMap'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  expectedCurrentId: z.uuid().nullable(),
  map: accountingMapBody,
})
export const exportDayCloseCommand = z.strictObject({
  action: z.literal('exportDayClose'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  dayCloseId: z.uuid(),
})

const ore = z.union([z.number().int(), z.string()]).transform(Number)
export const currentMap = z.object({
  id: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
  map: accountingMapBody,
  keys: z.array(z.string()),
})
export const voucherPreview = z.object({
  dayCloseId: z.uuid(),
  closeDate: z.string(),
  closeVersion: z.number().int(),
  mapId: z.uuid().nullable(),
  mapVersion: z.number().int(),
  exportId: z.uuid().nullable(),
  lines: z.array(voucherLine),
  debitOre: ore,
  creditOre: ore,
  balanced: z.boolean(),
  unmapped: z.array(z.string()),
})
export type VoucherPreview = z.infer<typeof voucherPreview>
const exportRow = z.object({
  id: z.uuid(),
  day_close_id: z.uuid(),
  map_id: z.uuid(),
  format: z.literal('sie4'),
  voucher: z.array(voucherLine),
  debit_ore: ore,
  credit_ore: ore,
  created_at: z.iso.datetime({ offset: true }),
})
const exportListRow = exportRow.extend({
  accounting_maps: z.object({ version: z.number().int() }).nullable(),
})
export type AccountingExport = z.infer<typeof exportListRow>

export async function readAccountingMap(
  client: SupabaseClient,
  tenantInput: string,
) {
  const { data, error } = await client.rpc('current_accounting_map', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (error) throw new Error('Unable to read accounting map')
  return currentMap.parse(data)
}

/** Voucher lines for one day close under the current map; guidance before an export. */
export async function previewVoucher(
  client: SupabaseClient,
  tenantInput: string,
  dayCloseInput: string,
) {
  const { data, error } = await client.rpc('preview_voucher', {
    p_tenant: z.uuid().parse(tenantInput),
    p_day_close: z.uuid().parse(dayCloseInput),
  })
  if (error) throw new Error('Unable to preview voucher')
  return voucherPreview.parse(data)
}

/** Newest 60 exports. RLS scopes the read. */
export async function readAccountingExports(
  client: SupabaseClient,
  tenantInput: string,
) {
  const { data, error } = await client
    .from('accounting_exports')
    .select(
      'id,day_close_id,map_id,format,voucher,debit_ore,credit_ore,created_at,accounting_maps(version)',
    )
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw new Error('Unable to read exports')
  return z.array(exportListRow).parse(data)
}

/** One export with its day close, for the file route. Null when unreadable. */
export async function readAccountingExport(
  client: SupabaseClient,
  tenantInput: string,
  exportInput: string,
) {
  const tenantId = z.uuid().parse(tenantInput)
  const row = await client
    .from('accounting_exports')
    .select(
      'id,day_close_id,map_id,format,voucher,debit_ore,credit_ore,created_at',
    )
    .eq('tenant_id', tenantId)
    .eq('id', z.uuid().parse(exportInput))
    .maybeSingle()
  if (row.error || !row.data) return null
  const parsed = exportRow.parse(row.data)
  const close = await client
    .from('day_closes')
    .select('close_date,version')
    .eq('tenant_id', tenantId)
    .eq('id', parsed.day_close_id)
    .maybeSingle()
  if (close.error || !close.data) return null
  return {
    ...parsed,
    closeDate: z.string().parse(close.data.close_date),
    closeVersion: z.number().int().parse(close.data.version),
  }
}
