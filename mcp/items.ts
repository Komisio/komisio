import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import {
  acceptItemPayload,
  proposeOperation,
  operationErrorCode,
} from '../lib/engine/operations'

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
