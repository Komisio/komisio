import { receptionSuggestions } from '../engine/reception'

/** Copy an unreviewed proposal into editable fields, never into accepted facts. */
export function quickAiProposal(input: unknown) {
  const suggestions = receptionSuggestions.parse(input)
  return {
    facts: Object.fromEntries([
      ['description', ''],
      ...suggestions.attributes.map(({ slug, value }) => [slug, value]),
    ]),
    itemType: suggestions.itemType ?? null,
    price: suggestions.price?.amount ?? '',
  }
}
