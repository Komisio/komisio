import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currencyCode } from './money'
import { economyPeriod } from './economy'

// Accounting reconciliation (P3): for each active local day in a period,
// where the books stand between the facts, the day close, the export and
// Fortnox. Computed in SQL from the same totals the day close uses; read only.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const reconciliationStatuses = [
  'no_close',
  'close_stale',
  'not_exported',
  'export_outdated',
  'not_sent',
  'send_pending',
  'send_failed',
  'sent',
] as const
export type ReconciliationStatus = (typeof reconciliationStatuses)[number]
export const reconciliation = z.object({
  from: isoDate,
  to: isoDate,
  timeZone: z.literal('Europe/Stockholm'),
  currency: currencyCode,
  mapVersion: z.number().int(),
  days: z
    .array(
      z.object({
        date: isoDate,
        status: z.enum(reconciliationStatuses),
        salesCount: z.number().int(),
        grossOre: ore,
        close: z
          .object({
            id: z.uuid(),
            version: z.number().int(),
            generatedAt: z.string(),
          })
          .nullable(),
        export: z
          .object({ id: z.uuid(), mapId: z.uuid(), createdAt: z.string() })
          .nullable(),
        send: z
          .object({
            id: z.uuid(),
            status: z.enum(['pending', 'sent', 'failed']),
            voucherSeries: z.string(),
            voucherNumber: z.number().int().nullable(),
            errorCode: z.string(),
            createdAt: z.string(),
          })
          .nullable(),
      }),
    )
    .max(367),
  counts: z.record(z.string(), z.number().int()),
})
export type Reconciliation = z.infer<typeof reconciliation>

/** Read for any member; null while the RPC is not migrated yet (deploy gap). */
export async function readReconciliation(
  client: SupabaseClient,
  tenantInput: string,
  periodInput: unknown,
) {
  const period = economyPeriod.parse(periodInput)
  const result = await client.rpc('accounting_reconciliation', {
    p_tenant: z.uuid().parse(tenantInput),
    p_from: period.from,
    p_to: period.to,
  })
  if (result.error) {
    if (result.error.message.includes('INVALID_INPUT'))
      throw new Error('INVALID_INPUT')
    if (result.error.code === 'PGRST202') return null
    throw new Error('FORBIDDEN')
  }
  return reconciliation.parse(result.data)
}

/** Days that still need a person: everything but sent and in progress. */
export function openDays(r: Reconciliation) {
  return r.days.filter((d) => !['sent', 'send_pending'].includes(d.status))
}
