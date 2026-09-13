import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { MCPConfig, MCPScope } from './config'
import { requireMCPIdentity } from './identity'
import {
  recordReturnPayload,
  adjustLedgerPayload,
  applyMarkdownBatchPayload,
  bulkItemUpdatePayload,
  sendMessagePayload,
  approvePayoutPayload,
  markPayoutPaidPayload,
  exportDayClosePayload,
  settlePayoutsPayload,
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
export const proposeMessageInput = sendMessagePayload.extend(envelope)
export const proposePayoutApprovalInput = approvePayoutPayload.extend(envelope)
export const proposePayoutPaymentInput = markPayoutPaidPayload.extend(envelope)
export const proposeDayCloseExportInput = exportDayClosePayload.extend(envelope)
export const proposeSettlementInput = settlePayoutsPayload.extend(envelope)

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

/** The free-text block of the general seller message; low: the proposer may approve. */
export async function proposeMessageTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, ...payload } = proposeMessageInput.parse(input)
  return {
    ...(await stage(
      client,
      config,
      'communications:propose',
      'sendMessage',
      'low',
      requestId,
      expiresAt,
      payload,
    )),
    sellerId: payload.sellerId,
    locale: payload.locale,
    templateBound: true,
    sentOnApprovalBy: 'store',
  }
}

/** Approve a requested payout; medium: a second person approves, the amount is reserved then. */
export async function proposePayoutApprovalTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, ...payload } =
    proposePayoutApprovalInput.parse(input)
  return {
    ...(await stage(
      client,
      config,
      'payouts:propose',
      'approvePayout',
      'medium',
      requestId,
      expiresAt,
      payload,
    )),
    payoutId: payload.payoutId,
  }
}

/** Mark an approved payout paid with the payment reference; medium: a second person approves. */
export async function proposePayoutPaymentTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, ...payload } =
    proposePayoutPaymentInput.parse(input)
  return {
    ...(await stage(
      client,
      config,
      'payouts:propose',
      'markPayoutPaid',
      'medium',
      requestId,
      expiresAt,
      payload,
    )),
    payoutId: payload.payoutId,
    reference: payload.reference,
  }
}

/** One payout per listed seller, requested and approved together; medium, all or nothing. */
export async function proposeSettlementTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, ...payload } =
    proposeSettlementInput.parse(input)
  return {
    ...(await stage(
      client,
      config,
      'payouts:propose',
      'settlePayouts',
      'medium',
      requestId,
      expiresAt,
      payload,
    )),
    sellers: payload.sellers.length,
    totalOre: payload.sellers.reduce((sum, s) => sum + s.amountOre, 0),
  }
}

/** Export one day close under the current account map; medium, idempotent per close and map. */
export async function proposeDayCloseExportTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { requestId, expiresAt, ...payload } =
    proposeDayCloseExportInput.parse(input)
  return {
    ...(await stage(
      client,
      config,
      'accounting:propose',
      'exportDayClose',
      'medium',
      requestId,
      expiresAt,
      payload,
    )),
    dayCloseId: payload.dayCloseId,
    format: 'sie4',
  }
}
