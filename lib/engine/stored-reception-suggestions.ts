import { z } from 'zod'
import { garmentSuggestions, receptionSuggestions } from './reception'

/** Read-only compatibility for immutable reviews from before attribute lists.
 * A present list wins, even when empty; new commands still require attributes.
 * Legacy facts predate versioned definitions and map to platform version one.
 */
export const storedReceptionSuggestions = z.preprocess((input) => {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    'attributes' in input
  )
    return input
  if (!('metadata' in input)) return input
  const metadata = garmentSuggestions.safeParse(input.metadata)
  if (!metadata.success) return input
  return {
    ...input,
    attributes: Object.entries(metadata.data).map(([slug, fact]) => ({
      slug,
      definitionVersion: 1,
      ...fact,
    })),
  }
}, receptionSuggestions)
