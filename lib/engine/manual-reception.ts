import { z } from 'zod'
import type { CurrencyCode } from './money'
import {
  receptionSession,
  receptionSuggestions,
  suggestedPrice,
  type ReceptionSession,
} from './reception'
const descriptionRef = 'komisio:manual-description:v1',
  appraisalRef = 'komisio:manual-appraisal:v1'
const appraisal = z.strictObject({
  amount: suggestedPrice.shape.amount,
  reference: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(500),
})
export function exactPrice(input: string) {
  const raw = input.trim().replace(',', '.')
  const normalized = /^\d+$/.test(raw)
    ? `${raw}.00`
    : /^\d+\.\d$/.test(raw)
      ? `${raw}0`
      : raw
  return suggestedPrice.shape.amount.parse(normalized)
}
export const manualReceptionInput = appraisal.extend({
  description: z.string().trim().min(1).max(1000),
})
export function manualReceptionSources(
  previous: ReceptionSession['sources'],
  input: unknown,
  descriptionId: string,
  appraisalId: string,
) {
  const c = manualReceptionInput.parse(input)
  return receptionSession.shape.sources.parse([
    ...previous.filter(
      (s) => s.reference !== descriptionRef && s.reference !== appraisalRef,
    ),
    {
      id: descriptionId,
      kind: 'observation',
      reference: descriptionRef,
      observation: c.description,
    },
    {
      id: appraisalId,
      kind: 'price-evidence',
      reference: appraisalRef,
      observation: JSON.stringify({
        amount: c.amount,
        reference: c.reference,
        rationale: c.rationale,
      }),
    },
  ])
}
/** Decode only this manual adapter's format. Arbitrary observations are not inferred prices. */
export function readManualReception(
  sources: ReceptionSession['sources'],
  currency: CurrencyCode = 'SEK',
) {
  const descriptions = sources.filter(
    (s) => s.kind === 'observation' && s.reference === descriptionRef,
  )
  const appraisals = sources.filter(
    (s) => s.kind === 'price-evidence' && s.reference === appraisalRef,
  )
  if (descriptions.length !== 1 || appraisals.length !== 1) return null
  try {
    const a = appraisal.parse(JSON.parse(appraisals[0].observation))
    const input = manualReceptionInput.parse({
      ...a,
      description: descriptions[0].observation,
    })
    return {
      input,
      suggestions: receptionSuggestions.parse({
        // description is a platform definition at version one, seeded with the
        // vocabulary, so a manual reception can name it without a lookup.
        attributes: [
          {
            slug: 'description',
            definitionVersion: 1,
            value: input.description,
            sourceIds: [descriptions[0].id],
            certainty: 'observed',
          },
        ],
        price: {
          currency,
          amount: a.amount,
          rationale: `${a.reference}: ${a.rationale}`,
          sourceIds: [appraisals[0].id],
        },
        questions: [],
      }),
    }
  } catch {
    return null
  }
}
