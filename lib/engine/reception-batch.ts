import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  batchCandidate,
  prepareReceptionBatch,
} from '../assistance/reception-batch'
import {
  receptionReviewField,
  reviewReceptionFacts,
} from './reception-fact-review'
import { readReceptionSession } from './reception-store'
import { readReceptionPhoto, uploadReceptionPhoto } from './reception-photos'
import { executeIntake } from './intake'
import { proposeOperation } from './operations'

export const stageBatchRowCommand = z.strictObject({
  tenantId: z.uuid(),
  sessionId: z.guid(),
  batchId: z.uuid(),
  revision: z.number().int().min(1).max(2147483646),
  row: z.number().int().min(0).max(7),
  candidate: batchCandidate,
  reviewedFields: z.array(receptionReviewField).max(8),
  confirmed: z.literal(true),
  agreementId: z.uuid().nullable(),
  expiresAt: z.iso.datetime(),
})
/** Namespaced UUIDv8 identifiers bind retries to the same row, not its mutable text. */
export function batchRowIds(input: unknown) {
  const c = stageBatchRowCommand.parse(input)
  const id = (purpose: string) => {
    const b = createHash('sha256')
      .update(
        JSON.stringify([
          'komisio:batch:v1',
          c.tenantId,
          c.sessionId,
          c.revision,
          c.batchId,
          c.row,
          purpose,
        ]),
      )
      .digest()
      .subarray(0, 16)
    b[6] = (b[6] & 15) | 128
    b[8] = (b[8] & 63) | 128
    const h = b.toString('hex')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  return {
    sessionId: id('session'),
    sourcesId: id('sources'),
    operationId: id('operation'),
  }
}

/** Staff-confirmed preparation only. Uses the caller's session and existing RLS/RPCs. */
export async function stageReceptionBatchRow(
  client: SupabaseClient,
  input: unknown,
) {
  const c = stageBatchRowCommand.parse(input),
    ids = batchRowIds(c)
  const role = await client.rpc('tenant_role', { p_tenant: c.tenantId })
  if (role.error || !['owner', 'admin', 'staff'].includes(role.data))
    throw new Error('FORBIDDEN')
  const parent = await readReceptionSession(client, c.tenantId, c.sessionId)
  if (parent?.status !== 'ready' || parent.session.revision !== c.revision)
    throw new Error('RECEPTION_CHANGED')
  const attempt = await client
    .from('reception_assistance_attempts')
    .select('session_id,source_revision,prompt_version')
    .eq('tenant_id', c.tenantId)
    .eq('id', c.batchId)
    .maybeSingle()
  if (
    attempt.error ||
    attempt.data?.session_id !== c.sessionId ||
    attempt.data.source_revision !== c.revision ||
    attempt.data.prompt_version !== 'reception-batch-v1'
  )
    throw new Error('BATCH_ATTEMPT_REQUIRED')
  // Validate this row against its selected sources, including price provenance.
  const subset = parent.session.sources.filter((s) =>
    c.candidate.sourceIds.includes(s.id),
  )
  const split = prepareReceptionBatch(
    { ...parent.session, sources: subset },
    { candidates: [c.candidate], questions: [] },
    c.batchId,
  )
  const review = reviewReceptionFacts(
    split.candidates[0].suggestions,
    c.reviewedFields,
  )
  if (!review.complete) throw new Error('RECEPTION_REVIEW_INCOMPLETE')
  const check = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message)
    return r.data
  }
  check(
    await executeIntake(client, {
      action: 'createReception',
      tenantId: c.tenantId,
      requestId: ids.sessionId,
      sellerId: parent.session.sellerId,
    }),
  )
  const sources = []
  for (const source of subset) {
    if (source.kind !== 'photo') {
      sources.push(source)
      continue
    }
    const photo = await readReceptionPhoto(client, {
      tenantId: c.tenantId,
      sessionId: c.sessionId,
      photoId: source.id,
    })
    if (!photo) throw new Error('ASSISTANCE_IMAGE_UNAVAILABLE')
    const copied = await uploadReceptionPhoto(
      client,
      { tenantId: c.tenantId, sessionId: ids.sessionId, photoId: source.id },
      photo.bytes,
    )
    sources.push({ ...copied, observation: source.observation })
  }
  check(
    await executeIntake(client, {
      action: 'saveReceptionSources',
      tenantId: c.tenantId,
      requestId: ids.sourcesId,
      sessionId: ids.sessionId,
      expectedRevision: 0,
      sources,
    }),
  )
  const current = await readReceptionSession(client, c.tenantId, c.sessionId)
  if (current?.status !== 'ready' || current.session.revision !== c.revision)
    throw new Error('RECEPTION_CHANGED')
  check(
    await proposeOperation(client, {
      tenantId: c.tenantId,
      requestId: ids.operationId,
      actorLabel: `Batch reception ${c.sessionId} / ${c.batchId}`,
      expiresAt: c.expiresAt,
      kind: 'publishReceptionReview',
      payload: {
        sessionId: ids.sessionId,
        sourceRevision: 1,
        previousReviewId: null,
        agreementId: c.agreementId,
        expiresAt: c.expiresAt,
        suggestions: review.suggestions,
      },
    }),
  )
  return { sessionId: ids.sessionId, operationId: ids.operationId }
}
