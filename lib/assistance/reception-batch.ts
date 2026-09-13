import { z } from 'zod'
import {
  prepareReceptionProposal,
  receptionSession,
  receptionSuggestions,
} from '../engine/reception'
import type { ReceptionAssistance, ReceptionEvidence } from './reception'

export const batchCandidate = z.strictObject({
  sourceIds: z
    .array(z.uuid())
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  suggestions: receptionSuggestions,
})
export const batchSuggestions = z.strictObject({
  candidates: z.array(batchCandidate).max(8),
  questions: z.array(z.string().trim().min(1).max(500)).max(10),
})
export type BatchCandidate = z.infer<typeof batchCandidate>

/** Pure boundary. Identities/storage references never come from a model. */
export function prepareReceptionBatch(
  input: unknown,
  candidate: unknown,
  batchId: string,
) {
  const session = receptionSession.parse(input)
  z.uuid().parse(batchId)
  const split = batchSuggestions.parse(candidate)
  const photos = session.sources.filter((s) => s.kind === 'photo')
  if (!photos.length || photos.length > 3)
    throw new Error('BATCH_PHOTOS_REQUIRED')
  if (!split.candidates.length && !split.questions.length)
    throw new Error('BATCH_EMPTY')
  const seen = new Set<string>()
  for (const row of split.candidates) {
    const sources = session.sources.filter((s) => row.sourceIds.includes(s.id))
    if (sources.length !== row.sourceIds.length)
      throw new Error('RECEPTION_UNKNOWN_SOURCE')
    if (!sources.some((s) => s.kind === 'photo'))
      throw new Error('BATCH_PHOTOS_REQUIRED')
    // A known source in another row is not evidence for this garment.
    const proposal = prepareReceptionProposal(
      { ...session, sources },
      row.suggestions,
      batchId,
    )
    for (const fact of Object.values(proposal.suggestions.metadata))
      if (fact) fact.certainty = 'tentative'
    row.suggestions = proposal.suggestions
    if (!row.suggestions.price && !row.suggestions.questions.length)
      throw new Error('BATCH_PRICE_QUESTION_REQUIRED')
    const key = JSON.stringify({
      sourceIds: [...row.sourceIds].sort(),
      suggestions: row.suggestions,
    })
    if (seen.has(key)) throw new Error('BATCH_DUPLICATE_ROW')
    seen.add(key)
  }
  if (
    photos.some(
      (p) => !split.candidates.some((c) => c.sourceIds.includes(p.id)),
    ) &&
    !split.questions.length
  )
    throw new Error('BATCH_UNASSIGNED_PHOTO')
  return {
    schemaVersion: 1 as const,
    batchId,
    tenantId: session.tenantId,
    sessionId: session.sessionId,
    sellerId: session.sellerId,
    baseRevision: session.revision,
    ...split,
  }
}

export async function suggestReceptionBatch(
  input: unknown,
  batchId: string,
  adapter: ReceptionAssistance | null,
  signal: AbortSignal,
) {
  const session = receptionSession.parse(input)
  if (!adapter) return { status: 'unavailable' as const, batch: null }
  signal.throwIfAborted()
  const evidence: ReceptionEvidence = {
    sources: session.sources.map((s) => ({
      id: s.id,
      observation: s.observation,
      ...(s.kind === 'photo'
        ? { kind: s.kind }
        : { kind: s.kind, reference: s.reference }),
    })),
  }
  const result = await adapter.suggest(evidence, signal)
  signal.throwIfAborted()
  return {
    status: 'proposed' as const,
    batch: prepareReceptionBatch(session, result, batchId),
  }
}
