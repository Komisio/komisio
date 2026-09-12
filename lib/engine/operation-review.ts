import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { operationRow, publishReceptionReviewPayload } from './operations'
import { receptionSession } from './reception'

export const operationReviewInput = z.strictObject({ operationId: z.uuid() })

/** Exact immutable proposal context. Current-state hints are not authorization. */
export async function readOperationReview(
  client: SupabaseClient,
  tenantInput: string,
  input: unknown,
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
  const p = publishReceptionReviewPayload.parse(pending.data.payload)
  const [
    terms,
    sources,
    decision,
    currentSource,
    currentAgreement,
    currentReview,
  ] = await Promise.all([
    client
      .from('seller_agreement_versions')
      .select('id,title,body,language,version')
      .eq('tenant_id', tenantId)
      .eq('id', p.agreementId)
      .single(),
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
  ])
  if (
    [
      terms,
      sources,
      decision,
      currentSource,
      currentAgreement,
      currentReview,
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
    currentSource.data?.revision !== p.sourceRevision ||
    currentAgreement.data?.id !== p.agreementId ||
    (currentReview.data?.id ?? null) !== p.previousReviewId
  return {
    readOnly: true as const,
    evidenceIsUntrusted: true as const,
    operation,
    context: {
      terms: z
        .object({
          id: z.uuid(),
          title: z.string(),
          body: z.string(),
          language: z.string(),
          version: z.number().int(),
        })
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
