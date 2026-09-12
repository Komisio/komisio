import { z } from 'zod'
import { garmentSuggestions, receptionSuggestions } from './reception'

const factNames = garmentSuggestions.keyof().options
export const receptionReviewField = z.enum([...factNames, 'price'])
export type ReceptionReviewField = z.infer<typeof receptionReviewField>
const selection = z
  .array(receptionReviewField)
  .max(8)
  .refine((v) => new Set(v).size === v.length)

/** Included facts only; optional absent fields never acquire a confirmation. */
export function receptionReviewFields(input: unknown): ReceptionReviewField[] {
  const c = receptionSuggestions.parse(input)
  return [
    ...factNames.filter((field) => !!c.metadata[field]),
    ...(c.price ? ['price' as const] : []),
  ]
}

/** UI review aid, not authorization. Unchecked model facts always stay tentative. */
export function reviewReceptionFacts(input: unknown, selectedInput: unknown) {
  const candidate = receptionSuggestions.parse(input),
    selected = selection.parse(selectedInput)
  const required = receptionReviewFields(candidate)
  if (selected.some((field) => !required.includes(field)))
    throw new Error('RECEPTION_REVIEW_SELECTION_INVALID')
  const suggestions = receptionSuggestions.parse({
    ...candidate,
    metadata: Object.fromEntries(
      factNames
        .filter((field) => !!candidate.metadata[field])
        .map((field) => [
          field,
          {
            ...candidate.metadata[field],
            certainty: selected.includes(field) ? 'observed' : 'tentative',
          },
        ]),
    ),
  })
  return {
    suggestions,
    complete:
      !!candidate.metadata.description &&
      !!candidate.price &&
      !candidate.questions.length &&
      required.every((field) => selected.includes(field)),
  }
}
