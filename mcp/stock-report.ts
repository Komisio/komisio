import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import { economyPeriod } from '../lib/engine/economy'
import { readStockReport } from '../lib/engine/stock-report'

// Stock report for agents: margin, sell-through and stock age per category.
// Amounts are öre; percentages are the engine's, rounded to one decimal.
export const stockReportInput = economyPeriod

export async function readStockReportTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const period = stockReportInput.parse(input)
  const actor = await requireMCPIdentity(client, config, 'economy:read')
  const report = await readStockReport(client, config.tenantId, period)
  if (!report) throw new Error('NOT_AVAILABLE')
  return {
    actor,
    readOnly: true,
    evidenceIsUntrusted: true,
    guidanceOnly: true,
    amountUnit: 'ore',
    ...report,
  }
}
