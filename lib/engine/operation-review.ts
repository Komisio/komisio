import { readStorePolicy } from './store-policy'
import { compareReceptionReview } from './reception-review-comparison'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  operationRow,
  publishReceptionReviewPayload,
  saveInspectionDraftPayload,
  acceptItemPayload,
  type PendingOperation,
} from './operations'
import { inspectionFields } from './inspection'
import { receptionSession } from './reception'

export const operationReviewInput = z.strictObject({ operationId: z.uuid() })

/** Exact immutable proposal context. Current-state hints are not authorization. */
export async function readOperationReview(
  client: SupabaseClient,
  tenantInput: string,
  input: unknown,
  allowedKind?: PendingOperation['kind'],
) {
  const tenantId = z.uuid().parse(tenantInput)
  const { operationId } = operationReviewInput.parse(input)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (
    role.error ||
    !['owner', 'admin', 'staff', 'readonly'].includes(role.data)
  )
    throw new Error('FORBIDDEN')
  const pending = await client
    .from('pending_operations')
    .select(
      'id,kind,risk_level,actor_kind,actor_label,proposed_by,payload,expires_at,created_at',
    )
    .eq('tenant_id', tenantId)
    .eq('id', operationId)
    .maybeSingle()
  if (pending.error || !pending.data) throw new Error('OPERATION_NOT_FOUND')
  if (allowedKind && pending.data.kind !== allowedKind)
    throw new Error('OPERATION_NOT_FOUND')
  if (pending.data.kind === 'saveInspectionDraft') {
    const p = saveInspectionDraftPayload.parse(pending.data.payload)
    const [base, current, decision] = await Promise.all([
      client
        .from('inspection_draft_revisions')
        .select('description,category,condition')
        .eq('tenant_id', tenantId)
        .eq('bag_id', p.bagId)
        .eq('draft_id', p.draftId)
        .eq('revision', p.expectedRevision)
        .single(),
      client
        .from('inspection_current')
        .select('revision,archived')
        .eq('tenant_id', tenantId)
        .eq('bag_id', p.bagId)
        .eq('draft_id', p.draftId)
        .maybeSingle(),
      client
        .from('operation_decisions')
        .select('id,outcome,result_id,error_code,reason,decided_by,created_at')
        .eq('tenant_id', tenantId)
        .eq('operation_id', operationId)
        .maybeSingle(),
    ])
    if (base.error || current.error || decision.error)
      throw new Error('OPERATION_NOT_FOUND')
    const d = decision.data,
      expired = Date.parse(pending.data.expires_at) <= Date.now()
    const operation = operationRow.parse({
      ...pending.data,
      status: d?.outcome ?? (expired ? 'expired' : 'open'),
      decision_id: d?.id ?? null,
      outcome: d?.outcome ?? null,
      result_id: d?.result_id ?? null,
      error_code: d?.error_code ?? null,
      reason: d?.reason ?? null,
      decided_by: d?.decided_by ?? null,
      decided_at: d?.created_at ?? null,
    })
    const before = inspectionFields.parse(base.data),
      after = p.fields
    const fields = ['description', 'category', 'condition'] as const
    const stale =
      current.data?.revision !== p.expectedRevision || !!current.data?.archived
    return {
      readOnly: true as const,
      evidenceIsUntrusted: true as const,
      operation,
      context: {
        kind: 'inspection' as const,
        before,
        after,
        changes: fields
          .filter((f) => before[f] !== after[f])
          .map((field) => ({
            field,
            before: before[field],
            after: after[field],
          })),
        stale,
        canApprove: !d && !expired && !stale,
        guidanceOnly: true as const,
      },
    }
  }
  if (pending.data.kind === 'acceptItem') {
    const p = acceptItemPayload.parse(pending.data.payload)
    const [existing, decision, currentDraft, currentReview] = await Promise.all(
      [
        client
          .from('items')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('origin_kind', p.originKind)
          .eq('origin_id', p.originId)
          .maybeSingle(),
        client
          .from('operation_decisions')
          .select(
            'id,outcome,result_id,error_code,reason,decided_by,created_at',
          )
          .eq('tenant_id', tenantId)
          .eq('operation_id', operationId)
          .maybeSingle(),
        p.originKind === 'inspection_draft'
          ? client
              .from('inspection_current')
              .select('revision,archived')
              .eq('tenant_id', tenantId)
              .eq('draft_id', p.originId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        p.originKind === 'reception_review'
          ? client
              .from('reception_reviews_current')
              .select('version')
              .eq('tenant_id', tenantId)
              .eq('session_id', p.originId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ],
    )
    if (
      existing.error ||
      decision.error ||
      currentDraft.error ||
      currentReview.error
    )
      throw new Error('OPERATION_NOT_FOUND')
    const d = decision.data,
      expired = Date.parse(pending.data.expires_at) <= Date.now()
    const operation = operationRow.parse({
      ...pending.data,
      status: d?.outcome ?? (expired ? 'expired' : 'open'),
      decision_id: d?.id ?? null,
      outcome: d?.outcome ?? null,
      result_id: d?.result_id ?? null,
      error_code: d?.error_code ?? null,
      reason: d?.reason ?? null,
      decided_by: d?.decided_by ?? null,
      decided_at: d?.created_at ?? null,
    })
    const originCurrent =
      p.originKind === 'inspection_draft'
        ? currentDraft.data?.revision === p.originRevision &&
          !currentDraft.data?.archived
        : p.originKind === 'reception_review'
          ? currentReview.data?.version === p.originRevision
          : true
    // Already accepted by anyone else, or the origin moved on: the proposal is stale.
    const stale = (!!existing.data && !d) || !originCurrent
    return {
      readOnly: true as const,
      evidenceIsUntrusted: true as const,
      operation,
      context: {
        kind: 'acceptance' as const,
        originKind: p.originKind,
        originId: p.originId,
        originRevision: p.originRevision,
        priceOre: p.priceOre,
        alreadyAccepted: !!existing.data,
        stale,
        canApprove: !d && !expired && !stale,
        guidanceOnly: true as const,
      },
    }
  }
  const p = publishReceptionReviewPayload.parse(pending.data.payload)
  const policy = await readStorePolicy(client, tenantId)
  const [
    terms,
    sources,
    decision,
    currentSource,
    currentAgreement,
    currentReview,
    previousReview,
  ] = await Promise.all([
    p.agreementId
      ? client
          .from('seller_agreement_versions')
          .select('id,title,body,language,version')
          .eq('tenant_id', tenantId)
          .eq('id', p.agreementId)
          .single()
      : Promise.resolve({ data: null, error: null }),
    client
      .from('reception_source_revisions')
      .select('sources')
      .eq('tenant_id', tenantId)
      .eq('session_id', p.sessionId)
      .eq('revision', p.sourceRevision)
      .single(),
    client
      .from('operation_decisions')
      .select('id,outcome,result_id,error_code,reason,decided_by,created_at')
      .eq('tenant_id', tenantId)
      .eq('operation_id', operationId)
      .maybeSingle(),
    client
      .from('reception_sources_current')
      .select('revision')
      .eq('tenant_id', tenantId)
      .eq('session_id', p.sessionId)
      .maybeSingle(),
    client
      .from('seller_agreement_versions')
      .select('id')
      .eq('tenant_id', tenantId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('reception_reviews')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('session_id', p.sessionId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    p.previousReviewId
      ? client
          .from('reception_reviews')
          .select('id,version,source_revision,agreement_id,suggestions')
          .eq('tenant_id', tenantId)
          .eq('session_id', p.sessionId)
          .eq('id', p.previousReviewId)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (
    [
      terms,
      sources,
      decision,
      currentSource,
      currentAgreement,
      currentReview,
      previousReview,
    ].some((r) => r.error)
  )
    throw new Error('OPERATION_NOT_FOUND')
  const d = decision.data
  const expired =
    Date.parse(pending.data.expires_at) <= Date.now() ||
    Date.parse(p.expiresAt) <= Date.now()
  const operation = operationRow.parse({
    ...pending.data,
    status: d?.outcome ?? (expired ? 'expired' : 'open'),
    decision_id: d?.id ?? null,
    outcome: d?.outcome ?? null,
    result_id: d?.result_id ?? null,
    error_code: d?.error_code ?? null,
    reason: d?.reason ?? null,
    decided_by: d?.decided_by ?? null,
    decided_at: d?.created_at ?? null,
  })
  const stale =
    (p.agreementId === null &&
      policy.policy.agreementRequiredFor.includes('review_publication')) ||
    currentSource.data?.revision !== p.sourceRevision ||
    (currentAgreement.data?.id ?? null) !== p.agreementId ||
    (currentReview.data?.id ?? null) !== p.previousReviewId
  return {
    readOnly: true as const,
    evidenceIsUntrusted: true as const,
    operation,
    context: {
      kind: 'reception' as const,
      comparison: compareReceptionReview(previousReview.data, p),
      terms: z
        .object({
          id: z.uuid(),
          title: z.string(),
          body: z.string(),
          language: z.string(),
          version: z.number().int(),
        })
        .nullable()
        .parse(terms.data),
      sources: receptionSession.shape.sources
        .parse(sources.data?.sources)
        .map((s) => ({
          id: s.id,
          kind: s.kind,
          observation: s.observation,
          reference: s.kind === 'photo' ? null : s.reference,
        })),
      stale,
      canApprove: !d && !expired && !stale,
      guidanceOnly: true as const,
    },
  }
}
export type OperationReviewContext = Awaited<
  ReturnType<typeof readOperationReview>
>['context']
