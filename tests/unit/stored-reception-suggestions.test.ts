import { expect, it } from 'vitest'
import { storedReceptionSuggestions } from '../../lib/engine/stored-reception-suggestions'
import { receptionSuggestions } from '../../lib/engine/reception'

const legacy = {
  metadata: {
    description: {
      value: 'Old lamp',
      sourceIds: ['10000000-0000-4000-8000-000000000001'],
      certainty: 'observed',
    },
  },
  price: null,
  questions: [],
}
it('reads immutable legacy facts without accepting legacy-only writes', () => {
  const before = JSON.stringify(legacy)
  expect(storedReceptionSuggestions.parse(legacy).attributes).toEqual([
    {
      slug: 'description',
      definitionVersion: 1,
      ...legacy.metadata.description,
    },
  ])
  expect(JSON.stringify(legacy)).toBe(before)
  expect(receptionSuggestions.safeParse(legacy).success).toBe(false)
})
it('never revives metadata when an explicit attribute list exists', () => {
  expect(
    storedReceptionSuggestions.parse({ ...legacy, attributes: [] }).attributes,
  ).toEqual([])
  expect(
    storedReceptionSuggestions.safeParse({ ...legacy, attributes: null })
      .success,
  ).toBe(false)
})
it('rejects corrupt historical facts rather than inventing evidence', () => {
  expect(
    storedReceptionSuggestions.safeParse({
      ...legacy,
      metadata: { description: { value: 'Old lamp' } },
    }).success,
  ).toBe(false)
})
