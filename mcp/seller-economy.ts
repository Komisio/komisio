import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import {
  readSellerBalance,
  readSellerLedger,
} from '../lib/engine/seller-ledger'

export const sellerEconomyInput = z.strictObject({ sellerId: z.uuid() })
const exactOre = z.number().int()
const markers = {
  readOnly: true,
  evidenceIsUntrusted: true,
  guidanceOnly: true,
  currency: 'SEK',
  amountUnit: 'ore',
} as const

export async function readSellerEconomyTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
  includeLedger = false,
) {
  const { sellerId } = sellerEconomyInput.parse(input)
  await requireMCPIdentity(client, config, 'economy:read')
  // This also distinguishes a missing/foreign seller from a seller with zero balance.
  const balance = await readSellerBalance(client, config.tenantId, sellerId)
  for (const amount of [
    balance.availableOre,
    balance.reservedOre,
    balance.creditedOre,
    balance.paidOre,
  ])
    exactOre.parse(amount)
  if (!includeLedger) return { ...markers, balance }
  const entries = await readSellerLedger(client, config.tenantId, sellerId)
  return {
    ...markers,
    sellerId,
    recentOnly: true,
    limit: 50,
    potentiallyTruncated: entries.length === 50,
    atomicSnapshot: false,
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      amountOre: exactOre.parse(entry.amount_ore),
      referenceKind: entry.reference_kind,
      referenceId: entry.reference_id,
      occurredAt: entry.occurred_at,
    })),
  }
}
