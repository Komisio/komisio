import { z } from 'zod'
import { garmentSuggestions, receptionSuggestions } from './reception'

const factNames = garmentSuggestions.keyof().options
/** A field a member of staff confirms: an attribute slug, or the price. The
 * seven fixed names are slugs like any other, so a screen written for them
 * keeps working while a lamp's socket becomes reviewable too. */
export const receptionReviewField = z
  .string()
  .regex(/^(price|[a-z][a-z0-9_]{0,39})$/)
export type ReceptionReviewField = z.infer<typeof receptionReviewField>
const selection = z
  .array(receptionReviewField)
  .max(100)
  .refine((v) => new Set(v).size === v.length)

/** The attribute list where a candidate has one, the seven fixed keys where it
 * does not. One shape means the review cannot silently skip what the fixed
 * keys have no room for. */
function observations(c: z.infer<typeof receptionSuggestions>) {
  if (c.attributes) return c.attributes.map((a) => a.slug)
  return factNames.filter((field) => !!c.metadata[field])
}

/** Included facts only; optional absent fields never acquire a confirmation. */
export function receptionReviewFields(input: unknown): ReceptionReviewField[] {
  const c = receptionSuggestions.parse(input)
  return [...observations(c), ...(c.price ? ['price' as const] : [])]
}

/** UI review aid, not authorization. Unchecked model facts always stay tentative. */
export function reviewReceptionFacts(input: unknown, selectedInput: unknown) {
  const candidate = receptionSuggestions.parse(input),
    selected = selection.parse(selectedInput)
  const required = receptionReviewFields(candidate)
  if (selected.some((field) => !required.includes(field)))
    throw new Error('RECEPTION_REVIEW_SELECTION_INVALID')
  const certainty = (slug: string) =>
    selected.includes(slug) ? ('observed' as const) : ('tentative' as const)
  const suggestions = receptionSuggestions.parse({
    ...candidate,
    metadata: Object.fromEntries(
      factNames
        .filter((field) => !!candidate.metadata[field])
        .map((field) => [
          field,
          { ...candidate.metadata[field], certainty: certainty(field) },
        ]),
    ),
    ...(candidate.attributes
      ? {
          attributes: candidate.attributes.map((a) => ({
            ...a,
            certainty: certainty(a.slug),
          })),
        }
      : {}),
  })
  const hasDescription = candidate.attributes
    ? candidate.attributes.some((a) => a.slug === 'description')
    : !!candidate.metadata.description
  return {
    suggestions,
    complete:
      hasDescription &&
      !!candidate.price &&
      !candidate.questions.length &&
      required.every((field) => selected.includes(field)),
  }
}
