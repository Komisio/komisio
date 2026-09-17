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

type Observation = { value: string; sourceIds: string[]; certainty: string }

/** What a review says about the item, by slug. The attribute list is the truth
 * where a review has one; the seven fixed keys are the same data for a review
 * published before the list existed. Reading one shape means a comparison
 * cannot silently ignore a lamp's socket just because no fixed key holds it. */
function observations(
  suggestions: z.infer<typeof receptionSuggestions>,
): Map<string, Observation> {
  const out = new Map<string, Observation>()
  if (suggestions.attributes) {
    for (const a of suggestions.attributes)
      out.set(a.slug, {
        value: a.value,
        sourceIds: a.sourceIds,
        certainty: a.certainty,
      })
    return out
  }
  for (const [slug, fact] of Object.entries(suggestions.metadata))
    if (fact) out.set(slug, fact)
  return out
}

/** The seven first, in their declared order, then anything else alphabetically,
 * so the list a reviewer reads is stable between two runs. */
function slugOrder(all: Set<string>): string[] {
  const known = garmentSuggestions.keyof().options as string[]
  const rest = [...all].filter((s) => !known.includes(s)).sort()
  return [...known.filter((s) => all.has(s)), ...rest]
}

function changedFields(
  previous: z.infer<typeof receptionSuggestions>,
  next: z.infer<typeof receptionSuggestions>,
) {
  const before = observations(previous),
    after = observations(next)
  return slugOrder(new Set([...before.keys(), ...after.keys()])).flatMap(
    (field) => {
      const b = before.get(field) ?? null,
        a = after.get(field) ?? null
      return b?.value !== a?.value ||
        !sameIds(b?.sourceIds ?? [], a?.sourceIds ?? [])
        ? [{ field, before: b, after: a }]
        : []
    },
  )
}

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
  const fields = changedFields(previous.suggestions, next.suggestions)
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
