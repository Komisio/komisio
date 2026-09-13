import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { MCPConfig, MCPScope } from './config'
import { requireMCPIdentity } from './identity'
import {
  recordReturnPayload,
  adjustLedgerPayload,
  applyMarkdownBatchPayload,
  bulkItemUpdatePayload,
  proposeOperation,
  operationErrorCode,
  type PendingOperation,
} from '../lib/engine/operations'

// P2 proposers: each tool stages one kind under its own scope. Nothing is
// returned, adjusted, marked down or repriced by these calls; a person decides
// in the operations queue, and SQL rechecks every precondition at approval.
const envelope = { requestId: z.uuid(), expiresAt: z.iso.datetime() }
export const proposeReturnInput = recordReturnPayload.extend(envelope)
export const proposeLedgerAdjustmentInput = adjustLedgerPayload.extend(envelope)
export const proposeMarkdownBatchInput =
  applyMarkdownBatchPayload.extend(envelope)
export const proposeBulkItemUpdateInput = z.strictObject({
  ...envelope,
  update: bulkItemUpdatePayload,
})

async function stage(
  client: SupabaseClient,
  config: MCPConfig,
  scope: MCPScope,
  kind: PendingOperation['kind'],
  riskLevel: 'low' | 'medium' | 'high',
  requestId: string,
  expiresAt: string,
  payload: unknown,
) {
  const actor = await requireMCPIdentity(client, config, scope)
  const result = await proposeOperation(client, {
    tenantId: config.tenantId,
    requestId,
    expiresAt,
    kind,
    payload,
    actorLabel: 'komisio-mcp',
  })
  if (result.error) throw new Error(operationErrorCode(result.error.message))
  return {
    actor,
    actorLabel: 'komisio-mcp',
    operationId: requestId,
    kind,
    riskLevel,
    persisted: true,
    staged: true,
    executed: false,
    requiresApproval: true,
    requiresDifferentApprover: riskLevel !== 'low',
  }
}

/** Full refund of one completed sale line; medium: a different person approves. */
export async function proposeReturnTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, ...payload } = proposeReturnInput.parse(input)
  return {
    ...(await stage(
      client,
      config,
      'sales:propose',
      'recordReturn',
      'medium',
      requestId,
      expiresAt,
      payload,
    )),
    saleLineId: payload.saleLineId,
    refundOre: payload.refundOre,
  }
}

/** Signed ledger adjustment; high: executes only for an owner or admin approver. */
export async function proposeLedgerAdjustmentTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, ...payload } =
    proposeLedgerAdjustmentInput.parse(input)
  return {
    ...(await stage(
      client,
      config,
      'ledger:propose',
      'adjustLedger',
      'high',
      requestId,
      expiresAt,
      payload,
    )),
    sellerId: payload.sellerId,
    amountOre: payload.amountOre,
    executesOnlyForOwnerOrAdmin: true,
  }
}

/** Markdown steps that are all due now; low: the proposing person may approve. */
export async function proposeMarkdownBatchTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, ...payload } =
    proposeMarkdownBatchInput.parse(input)
  return {
    ...(await stage(
      client,
      config,
      'lifecycle:propose',
      'applyMarkdownBatch',
      'low',
      requestId,
      expiresAt,
      payload,
    )),
    items: payload.items.length,
  }
}

/** One price change or end of period for a set of items; medium, all or nothing. */
export async function proposeBulkItemUpdateTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, update } =
    proposeBulkItemUpdateInput.parse(input)
  return {
    ...(await stage(
      client,
      config,
      'lifecycle:propose',
      'bulkItemUpdate',
      'medium',
      requestId,
      expiresAt,
      update,
    )),
    action: update.action,
    items: update.items.length,
  }
}
