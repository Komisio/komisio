import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import { readSettlementCandidates } from '../lib/engine/payouts'

// Settlement read for agents (P3): the sellers a batch would cover right now,
// as ids and öre only. Names and contacts stay in the store; nothing here
// requests, approves or pays.
export const settlementCandidatesInput = z.strictObject({})

export async function listSettlementCandidatesTool(
  client: SupabaseClient,
  config: MCPConfig,
) {
  const actor = await requireMCPIdentity(client, config, 'payouts:propose')
  const candidates = await readSettlementCandidates(client, config.tenantId)
  return {
    actor,
    readOnly: true,
    guidanceOnly: true,
    thresholdOre: candidates.thresholdOre,
    sellers: candidates.sellers.map((s) => ({
      sellerId: s.sellerId,
      availableOre: s.availableOre,
    })),
  }
}
