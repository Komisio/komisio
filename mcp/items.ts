import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import {
  acceptItemPayload,
  proposeOperation,
  operationErrorCode,
} from '../lib/engine/operations'
import { itemStage, readItem, readItemsOverview } from '../lib/engine/items'

const exactOre = z.number().int()
const readMarkers = {
  readOnly: true,
  evidenceIsUntrusted: true,
  guidanceOnly: true,
  amountUnit: 'ore',
} as const

export const findItemsInput = z.strictObject({
  query: z.string().trim().max(120).default(''),
  stage: itemStage.optional(),
  limit: z.number().int().min(1).max(100).default(50),
})
/** Newest accepted items first, by text in the origin's title or category and by lifecycle stage. Titles are the origin's untrusted text. */
export async function findItemsTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const filter = findItemsInput.parse(input)
  await requireMCPIdentity(client, config, 'items:read')
  const overview = await readItemsOverview(client, config.tenantId, filter)
  if (!overview) throw new Error('NOT_AVAILABLE')
  for (const item of overview.items)
    if (item.currentPriceOre !== null) exactOre.parse(item.currentPriceOre)
  return {
    ...readMarkers,
    currency: overview.currency,
    query: overview.query,
    stage: overview.stage,
    total: overview.total,
    limit: overview.limit,
    potentiallyTruncated: overview.total > overview.items.length,
    items: overview.items,
  }
}

export const itemSummaryInput = z.strictObject({ itemId: z.uuid() })
/** One item with its frozen terms, price series and event kinds. Free-text reasons and event details stay with the store. */
export async function readItemSummaryTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { itemId } = itemSummaryInput.parse(input)
  await requireMCPIdentity(client, config, 'items:read')
  const result = await readItem(client, config.tenantId, itemId)
  if (!result) throw new Error('NOT_FOUND')
  const { item, prices, events } = result
  return {
    ...readMarkers,
    item: {
      id: item.id,
      originKind: item.origin_kind,
      originId: item.origin_id,
      originRevision: item.origin_revision,
      sellerId: item.seller_id,
      ownership: item.ownership,
      custodyKind: item.custody_kind,
      acceptedAt: item.accepted_at,
      terms: item.terms,
    },
    prices: prices.map((p) => ({
      id: p.id,
      priceOre: exactOre.parse(p.price_ore),
      setAt: p.set_at,
    })),
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      occurredAt: e.occurred_at,
    })),
  }
}

export const proposeAcceptanceInput = acceptItemPayload.extend({
  requestId: z.uuid(),
  expiresAt: z.iso.datetime(),
})
/** Stages commercial acceptance at medium risk: a different person must approve. */
export async function proposeAcceptanceTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, ...payload } =
    proposeAcceptanceInput.parse(input)
  const actor = await requireMCPIdentity(client, config, 'items:propose')
  const result = await proposeOperation(client, {
    tenantId: config.tenantId,
    requestId,
    expiresAt,
    kind: 'acceptItem',
    payload,
    actorLabel: 'komisio-mcp',
  })
  if (result.error) throw new Error(operationErrorCode(result.error.message))
  return {
    actor,
    actorLabel: 'komisio-mcp',
    operationId: requestId,
    originKind: payload.originKind,
    originId: payload.originId,
    originRevision: payload.originRevision,
    priceOre: payload.priceOre,
    persisted: true,
    staged: true,
    executed: false,
    requiresApproval: true,
    requiresDifferentApprover: true,
    availableForSale: false,
    riskLevel: 'medium',
  }
}
