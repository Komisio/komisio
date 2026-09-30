import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { FortnoxProgressFacts } from '../help/fortnox-progress'

/** Existence reads, not capped recent lists. No provider calls or writes. */
export async function readFortnoxHelp(
  client: SupabaseClient,
  tenantInput: string,
  mapId: string | null,
  databaseNumber: string | null,
): Promise<Pick<FortnoxProgressFacts, 'exported' | 'sent'>> {
  const tenantId = z.uuid().parse(tenantInput)
  if (mapId === null) return { exported: false, sent: false }
  z.uuid().parse(mapId)
  const [exports, sends] = await Promise.all([
    client
      .from('accounting_exports')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('map_id', mapId)
      .limit(1)
      .maybeSingle(),
    databaseNumber === null
      ? null
      : client
          .from('fortnox_voucher_sends')
          .select('id,accounting_exports!inner(map_id)')
          .eq('tenant_id', tenantId)
          .eq('database_number', databaseNumber)
          .eq('status', 'sent')
          .eq('accounting_exports.map_id', mapId)
          .limit(1)
          .maybeSingle(),
  ])
  return {
    exported: exports.error ? null : exports.data !== null,
    sent: sends === null ? false : sends.error ? null : sends.data !== null,
  }
}
