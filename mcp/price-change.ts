import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import { readItem } from '../lib/engine/items'
import {
  priceEvidenceInput,
  readPriceEvidence,
} from '../lib/engine/price-evidence'
import { proposeOperation, operationErrorCode } from '../lib/engine/operations'

// Price proposal for one item (roadmap catalogue: "propose price change").
// The agent must cite the price evidence it read; the tool re-reads the same
// evidence and refuses a citation that no longer matches, so a proposal can
// never rest on numbers the store cannot see. It stages the existing
// bulkItemUpdate kind with one item at medium risk: a different person approves.
export const proposePriceChangeInput = z.strictObject({
  requestId: z.uuid(),
  expiresAt: z.iso.datetime(),
  itemId: z.guid(),
  priceOre: z.number().int().min(1).max(99_999_999_999),
  reason: z.string().trim().min(1).max(300),
  evidence: priceEvidenceInput.extend({
    count: z.number().int().min(0),
    medianSoldOre: z.number().int().nullable(),
  }),
})

export async function proposePriceChangeTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, itemId, priceOre, reason, evidence } =
    proposePriceChangeInput.parse(input)
  const actor = await requireMCPIdentity(client, config, 'lifecycle:propose')
  const current = await readItem(client, config.tenantId, itemId)
  if (!current) throw new Error('NOT_FOUND')
  const { count, medianSoldOre, ...query } = evidence
  const fresh = await readPriceEvidence(client, config.tenantId, query)
  if (
    fresh.summary.count !== count ||
    (fresh.summary.medianSoldOre ?? null) !== medianSoldOre
  )
    throw new Error('EVIDENCE_STALE')
  const citation = `evidence: category=${fresh.category ?? '-'} query=${fresh.query ?? '-'} days=${fresh.days} sold=${fresh.summary.count} median=${fresh.summary.medianSoldOre ?? '-'} ore`
  const result = await proposeOperation(client, {
    tenantId: config.tenantId,
    requestId,
    expiresAt,
    kind: 'bulkItemUpdate',
    payload: {
      action: 'setPrice',
      reason: `${reason} [${citation}]`,
      items: [{ itemId, priceOre }],
    },
    actorLabel: 'komisio-mcp',
  })
  if (result.error) throw new Error(operationErrorCode(result.error.message))
  return {
    actor,
    actorLabel: 'komisio-mcp',
    operationId: requestId,
    kind: 'bulkItemUpdate',
    riskLevel: 'medium',
    persisted: true,
    staged: true,
    executed: false,
    requiresApproval: true,
    requiresDifferentApprover: true,
    itemId,
    currentPriceOre: current.prices[0]?.price_ore ?? null,
    proposedPriceOre: priceOre,
    evidence: {
      category: fresh.category,
      query: fresh.query,
      days: fresh.days,
      count: fresh.summary.count,
      medianSoldOre: fresh.summary.medianSoldOre,
    },
    isNotAPrice: true,
  }
}
