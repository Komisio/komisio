import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionSuggestions } from './reception'
import { inspectionFields } from './inspection'

// A staged operation is a proposal by a non-human actor. It publishes nothing
// until a person decides; execution then reuses the ordinary engine function.
export const operationKind = z.enum([
  'publishReceptionReview',
  'saveInspectionDraft',
])
export const publishReceptionReviewPayload = z.strictObject({
  sessionId: z.uuid(),
  sourceRevision: z.number().int().min(1).max(2147483646),
  previousReviewId: z.uuid().nullable(),
  agreementId: z.uuid().nullable(),
  expiresAt: z.iso.datetime(),
  suggestions: receptionSuggestions.refine(
    (s) =>
      !!s.metadata.description &&
      !!s.price &&
      s.questions.length === 0 &&
      Object.values(s.metadata).every((f) => f?.certainty === 'observed'),
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
  return z.array(operationRow).max(50).parse(data)
}
