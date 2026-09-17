import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionSuggestions } from './reception'
import { inspectionFields } from './inspection'
import { storeProfileBody } from './store-profile'
import { locales } from '../i18n'

// A staged operation is a proposal by a non-human actor. It publishes nothing
// until a person decides; execution then reuses the ordinary engine function.
export const operationKind = z.enum([
  'publishReceptionReview',
  'saveInspectionDraft',
  'acceptItem',
  'recordReturn',
  'adjustLedger',
  'applyMarkdownBatch',
  'bulkItemUpdate',
  'approvePayout',
  'markPayoutPaid',
  'sendMessage',
  'exportDayClose',
  'settlePayouts',
  'updateStoreProfile',
  'importSellers',
])
export const publishReceptionReviewPayload = z.strictObject({
  sessionId: z.guid(),
  sourceRevision: z.number().int().min(1).max(2147483646),
  previousReviewId: z.uuid().nullable(),
  agreementId: z.uuid().nullable(),
  expiresAt: z.iso.datetime(),
  suggestions: receptionSuggestions.refine(
    (s) =>
      s.attributes.some((a) => a.slug === 'description') &&
      !!s.price &&
      s.questions.length === 0 &&
      s.attributes.every((a) => a.certainty === 'observed'),
  ),
})
export const saveInspectionDraftPayload = z.strictObject({
  bagId: z.uuid(),
  draftId: z.uuid(),
  expectedRevision: z.number().int().min(1).max(2147483646),
  fields: inspectionFields.extend({
    description: z.string().trim().min(1).max(1000),
  }),
})
// Commercial acceptance (P1 S4): medium risk, so a different person must approve.
export const acceptItemPayload = z
  .strictObject({
    originKind: z.enum(['inspection_draft', 'reception_review', 'purchase']),
    originId: z.guid(),
    originRevision: z.number().int().min(1).max(2147483646).nullable(),
    priceOre: z.number().int().min(1).max(99_999_999_999),
  })
  .refine(
    (v) => (v.originKind === 'purchase') === (v.originRevision === null),
    'Purchase origins carry no revision; the others require one',
  )
// P2 staged kinds. Full refund of one completed sale line (medium); a signed
// ledger adjustment (high, executed only when the approver may adjust); a batch
// of markdown steps that are all due now (low, all or nothing).
export const recordReturnPayload = z.strictObject({
  saleLineId: z.guid(),
  refundOre: z.number().int().min(1).max(99_999_999_999),
  reason: z.string().trim().min(1).max(500),
})
export const adjustLedgerPayload = z.strictObject({
  sellerId: z.uuid(),
  amountOre: z
    .number()
    .int()
    .min(-99_999_999_999)
    .max(99_999_999_999)
    .refine((v) => v !== 0, 'An adjustment moves money'),
  reason: z.string().trim().min(1).max(500),
})
export const applyMarkdownBatchPayload = z.strictObject({
  items: z
    .array(
      z.strictObject({
        itemId: z.guid(),
        step: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50)
    .refine(
      (list) => new Set(list.map((i) => i.itemId)).size === list.length,
      'Each item once',
    ),
})
// Bulk item update (medium): one price change or one end of period for up to
// 50 items; the whole set is refused if any item is sold or ended.
const uniqueItems = <T extends { itemId: string }>(list: T[]) =>
  new Set(list.map((i) => i.itemId)).size === list.length
export const bulkItemUpdatePayload = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('setPrice'),
    reason: z.string().trim().min(1).max(500),
    items: z
      .array(
        z.strictObject({
          itemId: z.guid(),
          priceOre: z.number().int().min(1).max(99_999_999_999),
        }),
      )
      .min(1)
      .max(50)
      .refine(uniqueItems, 'Each item once'),
  }),
  z.strictObject({
    action: z.literal('endPeriod'),
    endAction: z.enum(['charity', 'return']),
    note: z.string().max(500),
    items: z
      .array(z.strictObject({ itemId: z.guid() }))
      .min(1)
      .max(50)
      .refine(uniqueItems, 'Each item once'),
  }),
])
// Payout transitions (medium): approve a requested payout, or mark an approved
// payout paid with the payment reference. Execution runs the ordinary transition.
export const approvePayoutPayload = z.strictObject({
  payoutId: z.uuid(),
  reason: z.string().max(500),
})
export const markPayoutPaidPayload = z.strictObject({
  payoutId: z.uuid(),
  reference: z.string().trim().min(1).max(200),
  reason: z.string().max(500),
})
// Template-bound seller message (low): only the free-text block is proposed;
// the template around it is code. Approval is the fact; the app then sends.
export const sendMessagePayload = z.strictObject({
  sellerId: z.uuid(),
  locale: z.enum(locales),
  freeText: z.string().trim().min(1).max(1000),
})
// Day close export (medium): the ordinary idempotent export under the current map.
export const exportDayClosePayload = z.strictObject({ dayCloseId: z.uuid() })
// Settlement batch (medium, P3): one payout per listed seller, requested and
// approved together as the approver; refused whole if any seller is below the
// threshold, over its balance or already has an open payout.
export const settlePayoutsPayload = z.strictObject({
  sellers: z
    .array(
      z.strictObject({
        sellerId: z.uuid(),
        amountOre: z.number().int().min(1).max(99_999_999_999),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (list) => new Set(list.map((s) => s.sellerId)).size === list.length,
      'Each seller once',
    ),
  reason: z.string().trim().min(1).max(500),
})
// Store profile update (low, P3): the next version of the public-facing
// profile, naming the current version; publishing stays owner or admin.
export const updateStoreProfilePayload = z.strictObject({
  expectedCurrentId: z.uuid().nullable(),
  profile: storeProfileBody,
})
// Seller import (low, P5 import wizard): rows a person mapped and previewed;
// approval registers them through register_seller, skipping known e-mails.
export const importSellersPayload = z.strictObject({
  source: z.string().trim().min(1).max(200),
  rows: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().max(254),
        phone: z.string().trim().max(40),
      }),
    )
    .min(1)
    .max(200),
})
const proposeBase = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  actorLabel: z.string().trim().min(1).max(100),
  expiresAt: z.iso.datetime(),
})
export const proposeOperationCommand = z.discriminatedUnion('kind', [
  proposeBase.extend({
    kind: z.literal('publishReceptionReview'),
    payload: publishReceptionReviewPayload,
  }),
  proposeBase.extend({
    kind: z.literal('saveInspectionDraft'),
    payload: saveInspectionDraftPayload,
  }),
  proposeBase.extend({
    kind: z.literal('acceptItem'),
    payload: acceptItemPayload,
  }),
  proposeBase.extend({
    kind: z.literal('recordReturn'),
    payload: recordReturnPayload,
  }),
  proposeBase.extend({
    kind: z.literal('adjustLedger'),
    payload: adjustLedgerPayload,
  }),
  proposeBase.extend({
    kind: z.literal('applyMarkdownBatch'),
    payload: applyMarkdownBatchPayload,
  }),
  proposeBase.extend({
    kind: z.literal('bulkItemUpdate'),
    payload: bulkItemUpdatePayload,
  }),
  proposeBase.extend({
    kind: z.literal('approvePayout'),
    payload: approvePayoutPayload,
  }),
  proposeBase.extend({
    kind: z.literal('markPayoutPaid'),
    payload: markPayoutPaidPayload,
  }),
  proposeBase.extend({
    kind: z.literal('sendMessage'),
    payload: sendMessagePayload,
  }),
  proposeBase.extend({
    kind: z.literal('exportDayClose'),
    payload: exportDayClosePayload,
  }),
  proposeBase.extend({
    kind: z.literal('settlePayouts'),
    payload: settlePayoutsPayload,
  }),
  proposeBase.extend({
    kind: z.literal('updateStoreProfile'),
    payload: updateStoreProfilePayload,
  }),
  proposeBase.extend({
    kind: z.literal('importSellers'),
    payload: importSellersPayload,
  }),
])
export const decideOperationCommand = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  operationId: z.uuid(),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).default(''),
})
export const operationStatus = z.enum([
  'open',
  'expired',
  'executed',
  'failed',
  'rejected',
])
const operationBaseRow = z.object({
  id: z.uuid(),
  risk_level: z.enum(['low', 'medium', 'high']),
  actor_kind: z.literal('agent'),
  actor_label: z.string(),
  proposed_by: z.uuid(),
  expires_at: z.iso.datetime({ offset: true }),
  created_at: z.iso.datetime({ offset: true }),
  status: operationStatus,
  decision_id: z.uuid().nullable(),
  outcome: z.enum(['executed', 'failed', 'rejected']).nullable(),
  result_id: z.uuid().nullable(),
  error_code: z.string().nullable(),
  reason: z.string().nullable(),
  decided_by: z.uuid().nullable(),
  decided_at: z.iso.datetime({ offset: true }).nullable(),
})
export const operationRow = z.discriminatedUnion('kind', [
  operationBaseRow.extend({
    kind: z.literal('publishReceptionReview'),
    payload: publishReceptionReviewPayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('saveInspectionDraft'),
    payload: saveInspectionDraftPayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('acceptItem'),
    payload: acceptItemPayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('recordReturn'),
    payload: recordReturnPayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('adjustLedger'),
    payload: adjustLedgerPayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('applyMarkdownBatch'),
    payload: applyMarkdownBatchPayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('bulkItemUpdate'),
    payload: bulkItemUpdatePayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('approvePayout'),
    payload: approvePayoutPayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('markPayoutPaid'),
    payload: markPayoutPaidPayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('sendMessage'),
    payload: sendMessagePayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('exportDayClose'),
    payload: exportDayClosePayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('settlePayouts'),
    payload: settlePayoutsPayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('updateStoreProfile'),
    payload: updateStoreProfilePayload,
  }),
  operationBaseRow.extend({
    kind: z.literal('importSellers'),
    payload: importSellersPayload,
  }),
])
export type PendingOperation = z.infer<typeof operationRow>
export const operationErrorCodes = [
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'RECEPTION_NOT_FOUND',
  'RECEPTION_CHANGED',
  'RECEPTION_REVIEW_CHANGED',
  'RECEPTION_REVIEW_EXPIRED',
  'RECEPTION_UNKNOWN_SOURCE',
  'RECEPTION_PRICE_EVIDENCE_REQUIRED',
  'AGREEMENT_CHANGED',
  'OPERATION_NOT_FOUND',
  'OPERATION_DECIDED',
  'OPERATION_EXPIRED',
  'INSPECTION_NOT_FOUND',
  'INSPECTION_DRAFT_CHANGED',
  'INSPECTION_ARCHIVED',
  'INSPECTION_UNCHANGED',
  'ORIGIN_NOT_FOUND',
  'ITEM_EXISTS',
  'CUSTODY_REQUIRED',
  'SELLER_APPROVAL_REQUIRED',
  'PRICE_NOT_APPROVED',
  'AGREEMENT_REQUIRED',
  'SALE_LINE_NOT_FOUND',
  'SALE_NOT_COMPLETED',
  'LINE_ALREADY_RETURNED',
  'PARTIAL_REFUND_UNSUPPORTED',
  'SELLER_NOT_FOUND',
  'ITEM_NOT_FOUND',
  'ITEM_NOT_ON_SALE',
  'ITEM_ENDED',
  'MARKDOWN_NOT_DUE',
  'MARKDOWN_ALREADY_APPLIED',
  'PAYOUT_NOT_FOUND',
  'PAYOUT_NOT_REQUESTED',
  'PAYOUT_NOT_APPROVED',
  'PAYOUT_EXCEEDS_BALANCE',
  'PAYOUT_BELOW_THRESHOLD',
  'PAYOUT_PENDING',
  'PROFILE_CHANGED',
  'PAYOUT_DECIDED',
  'SELLER_EMAIL_MISSING',
  'DAY_CLOSE_NOT_FOUND',
  'ACCOUNTING_MAP_REQUIRED',
  'VOUCHER_UNBALANCED',
  'ZETTLE_IMPORT_NOT_FOUND',
  'ZETTLE_MATCH_CHANGED',
  'ZETTLE_UNMATCHED_LINES',
  'ZETTLE_UNSUPPORTED_PURCHASE',
  'SALE_CONFLICT',
  'ITEM_ALREADY_SOLD',
] as const
export function operationErrorCode(message: string) {
  return (
    operationErrorCodes.find((c) => message.includes(c)) ?? 'REQUEST_FAILED'
  )
}

/** Proposes as the authenticated user; SQL rechecks role, MFA, revision and replay. */
export async function proposeOperation(client: SupabaseClient, input: unknown) {
  const c = proposeOperationCommand.parse(input)
  return client.rpc('propose_operation', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_kind: c.kind,
    p_payload: c.payload,
    p_actor_label: c.actorLabel,
    p_expires: c.expiresAt,
  })
}

/** Approval executes the engine function as the deciding person; rejection records only. */
export async function decideOperation(client: SupabaseClient, input: unknown) {
  const c = decideOperationCommand.parse(input)
  return client.rpc('decide_operation', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_operation: c.operationId,
    p_decision: c.decision === 'approve' ? 'approved' : 'rejected',
    p_reason: c.reason,
  })
}

/** Staff read of the newest 50 proposals with derived status; RLS and MFA enforced in SQL. */
export async function readOperationQueue(
  client: SupabaseClient,
  tenantInput: string,
) {
  const { data, error } = await client.rpc('operation_queue', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (error) throw new Error('Unable to read operation queue')
  const rows = z
    .array(z.object({ kind: z.string() }).passthrough())
    .max(50)
    .parse(data)
  return z
    .array(operationRow)
    .parse(rows.filter((row) => row.kind !== 'recordZettlePurchase'))
}
