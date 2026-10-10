import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Dictionary } from '@/lib/i18n'
import { stocktakeRow } from './stocktake'

export const stocktakeExportFilter = z.enum(['all', 'deviations'])
export const stocktakeExport = z.object({
  id: z.uuid(),
  version: z.number().int().nonnegative(),
  startedAt: z.string(),
  closedAt: z.string(),
  filter: stocktakeExportFilter,
  rows: z.array(stocktakeRow).max(5000),
})
export type StocktakeExport = z.infer<typeof stocktakeExport>

export async function readStocktakeExport(
  client: SupabaseClient,
  tenant: string,
  session: string,
  filter: z.infer<typeof stocktakeExportFilter>,
) {
  const result = await client.rpc('stocktake_export', {
    p_tenant: z.uuid().parse(tenant),
    p_session: z.uuid().parse(session),
    p_filter: stocktakeExportFilter.parse(filter),
  })
  if (result.error) throw new Error(result.error.message)
  const report = stocktakeExport.parse(result.data)
  if (report.id !== session || report.filter !== filter)
    throw new Error('Invalid stocktake export identity')
  return report
}

function cell(value: string) {
  // CSV quoting does not neutralize spreadsheet formulas.
  const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function stocktakeCsv(
  report: StocktakeExport,
  store: string,
  s: Dictionary['stocktake'],
) {
  const headings = [
    s.exportStore,
    s.exportSession,
    s.exportClosed,
    s.exportScope,
    s.exportItemId,
    s.exportLabel,
    s.exportTitle,
    s.exportObservation,
    s.exportException,
    s.reason,
    s.exportActor,
    s.exportObservedAt,
  ]
  const rows = report.rows.map((r) => [
    store,
    report.id,
    report.closedAt,
    s[report.filter],
    r.id,
    `I-${r.id.slice(0, 8).toUpperCase()}`,
    r.title,
    s[r.observation],
    [r.changed ? s.changed : '', !r.expected ? s.unexpected : '']
      .filter(Boolean)
      .join(' · '),
    r.reason,
    r.actor,
    r.at ?? '',
  ])
  const csv =
    '\uFEFF' +
    [headings, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') +
    '\r\n'
  // Includes UTF-8 expansion and CSV escaping, below the hosted response limit.
  if (new TextEncoder().encode(csv).byteLength > 3_500_000)
    throw new Error('STOCKTAKE_EXPORT_TOO_LARGE')
  return csv
}
