import { z } from 'zod'
import { garmentSuggestions, receptionSuggestions } from './reception'
import { publishReceptionReviewPayload } from './operations'

const baseline = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  source_revision: z.number().int().positive(),
  agreement_id: z.uuid().nullable(),
  suggestions: receptionSuggestions,
})
const sameIds = (a: string[], b: string[]) =>
  [...a].sort().join(',') === [...b].sort().join(',')

/** Limited comparison against the pinned publication; never authorization. */
export function compareReceptionReview(
  previousInput: unknown,
  nextInput: unknown,
) {
  const next = publishReceptionReviewPayload.parse(nextInput)
  if (next.previousReviewId === null) {
    if (previousInput !== null) throw new Error('RECEPTION_REVIEW_CHANGED')
    return null
  }
  const previous = baseline.parse(previousInput)
  if (previous.id !== next.previousReviewId)
    throw new Error('RECEPTION_REVIEW_CHANGED')
  const fields = garmentSuggestions.keyof().options.flatMap((field) => {
    const before = previous.suggestions.metadata[field] ?? null
    const after = next.suggestions.metadata[field] ?? null
    return before?.value !== after?.value ||
      !sameIds(before?.sourceIds ?? [], after?.sourceIds ?? [])
      ? [{ field, before, after }]
      : []
  })
  const beforePrice = previous.suggestions.price,
    afterPrice = next.suggestions.price
  const priceChanged =
    beforePrice?.amount !== afterPrice?.amount ||
    beforePrice?.rationale !== afterPrice?.rationale ||
    !sameIds(beforePrice?.sourceIds ?? [], afterPrice?.sourceIds ?? [])
  return {
    previousReviewId: previous.id,
    previousVersion: previous.version,
    sourceRevisionChanged: previous.source_revision !== next.sourceRevision,
    agreementChanged: previous.agreement_id !== next.agreementId,
    fields,
    price: priceChanged ? { before: beforePrice, after: afterPrice } : null,
    guidanceOnly: true as const,
  }
}
