import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import { economyPeriod, readEconomySummary } from '../lib/engine/economy'

// Store economy read for agents (P3): the period totals a brief is written
// from. Amounts are öre; the numbers are the store's own, computed in SQL.
// No seller names, no writes.
export const economySummaryInput = economyPeriod

export async function readEconomySummaryTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const period = economySummaryInput.parse(input)
  const actor = await requireMCPIdentity(client, config, 'economy:read')
  const summary = await readEconomySummary(client, config.tenantId, period)
  return {
    actor,
    readOnly: true,
    evidenceIsUntrusted: true,
    guidanceOnly: true,
    currency: 'SEK',
    amountUnit: 'ore',
    ...summary,
  }
}
