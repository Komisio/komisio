import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import { readDayCloses } from '../lib/engine/day-closes'
import { previewVoucher } from '../lib/engine/accounting'

// Accounting reads for agents (P2 S17): day closes and the voucher preview
// under the tenant's own map. Amounts are öre; account numbers are the
// tenant's; nothing here writes, exports or sends.
export const dayCloseListInput = z.strictObject({})
export const dayClosePreviewInput = z.strictObject({ dayCloseId: z.uuid() })

export async function listDayClosesTool(
  client: SupabaseClient,
  config: MCPConfig,
) {
  const actor = await requireMCPIdentity(client, config, 'accounting:read')
  const closes = await readDayCloses(client, config.tenantId)
  return {
    actor,
    readOnly: true,
    guidanceOnly: true,
    items: closes.map((c) => ({
      dayCloseId: c.id,
      closeDate: c.close_date,
      version: c.version,
      salesCount: c.sales_count,
      returnsCount: c.returns_count,
      grossOre: c.gross_ore,
      vatOre: c.vat_ore,
      commissionOre: c.commission_ore,
      sellerCreditOre: c.seller_credit_ore,
      refundsOre: c.refunds_ore,
      payoutsPaidOre: c.payouts_paid_ore,
    })),
  }
}

export async function previewDayCloseTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { dayCloseId } = dayClosePreviewInput.parse(input)
  const actor = await requireMCPIdentity(client, config, 'accounting:read')
  const preview = await previewVoucher(client, config.tenantId, dayCloseId)
  return {
    actor,
    readOnly: true,
    guidanceOnly: true,
    accountsAreTheTenants: true,
    ...preview,
  }
}
