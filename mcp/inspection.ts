import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { MCPConfig } from './config'
import { readInspection } from '../lib/engine/inspection-read'
import { requireMCPIdentity } from './identity'
import { readBagQueue } from '../lib/engine/bag-queue'
import { previewSavedInspection } from '../lib/engine/inspection-preview'

export async function previewInspectionTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const actor = await requireMCPIdentity(client, config, 'inspection:preview')
  return {
    actor,
    ...(await previewSavedInspection(client, config.tenantId, input)),
  }
}

// Strings preserve the printed reference/cursor interchange; engine validates
// normalization and safe integer bounds before constructing the database query.
export const bagListInput = z.strictObject({
  bag: z.string().max(20).optional(),
  older: z.string().max(16).optional(),
  newer: z.string().max(16).optional(),
})

export async function listBagsTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const args = bagListInput.parse(input)
  const actor = await requireMCPIdentity(client, config, 'inspection:read')
  const result = await readBagQueue(client, config.tenantId, args)
  return {
    actor,
    readOnly: true as const,
    evidenceIsUntrusted: true as const,
    availableForSale: false as const,
    items: result.items.map((bag) => ({
      bagId: bag.id,
      reference: `K-${bag.reference}`,
      receivedAt: bag.received_at,
    })),
    older:
      result.hasOlder && result.items.length
        ? String(result.items.at(-1)!.reference)
        : null,
    newer:
      result.hasNewer && result.items.length
        ? String(result.items[0].reference)
        : null,
  }
}

export async function readInspectionTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const actor = await requireMCPIdentity(client, config, 'inspection:read')
  const result = await readInspection(client, config.tenantId, input)
  return { ...result, actor, bag: { reference: result.bag.reference } }
}
