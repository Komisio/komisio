import { expect, it } from 'vitest'
import { compareReceptionReview } from '../../lib/engine/reception-review-comparison'
const id = (n: number) =>
  `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const fact = (slug: string, value: string, sourceIds = [id(1)]) => ({
  slug,
  definitionVersion: 1,
  value,
  sourceIds,
  certainty: 'observed',
})
const prior = () => ({
  id: id(2),
  version: 3,
  source_revision: 2,
  agreement_id: id(3),
  suggestions: {
    attributes: [fact('description', 'Jacket'), fact('color', 'Blue')],
    price: {
      currency: 'SEK',
      amount: '100.00',
      rationale: 'Appraisal',
      sourceIds: [id(4), id(5)],
    },
    questions: [],
  },
})
const next = () => ({
  sessionId: id(6),
  sourceRevision: 2,
  previousReviewId: id(2),
  agreementId: id(3),
  expiresAt: '2099-01-01T00:00:00Z',
  suggestions: prior().suggestions,
})
it('unchanged values and reordered citations do not invent changes or mutate evidence', () => {
  const before = prior(),
    after = next(),
    snapshot = structuredClone(before)
  after.suggestions.price.sourceIds.reverse()
  const diff = compareReceptionReview(before, after)!
  expect(diff).toMatchObject({
    previousReviewId: id(2),
    previousVersion: 3,
    fields: [],
    price: null,
    sourceRevisionChanged: false,
    agreementChanged: false,
    guidanceOnly: true,
  })
  expect(before).toEqual(snapshot)
})
it('reports added, removed and citation-only facts', () => {
  const after = next()
  after.suggestions.attributes = [
    fact('description', 'Jacket', [id(7)]),
    fact('brand', 'TEST'),
  ]
  const diff = compareReceptionReview(prior(), after)!
  // slugOrder puts the declared seven first in their own order, so brand
  // precedes colour however the two reviews happened to list them.
  expect(diff.fields.map((f) => f.field)).toEqual([
    'description',
    'brand',
    'color',
  ])
  expect(diff.fields.find((f) => f.field === 'color')).toMatchObject({
    before: { value: 'Blue' },
    after: null,
  })
  expect(diff.fields.find((f) => f.field === 'brand')).toMatchObject({
    before: null,
    after: { value: 'TEST' },
  })
})
it('rationale and source/terms changes remain visible even at the same price', () => {
  const after = next()
  after.suggestions.price.rationale = 'Revised evidence'
  after.sourceRevision = 3
  after.agreementId = id(9)
  expect(compareReceptionReview(prior(), after)).toMatchObject({
    price: {
      before: { amount: '100.00', rationale: 'Appraisal' },
      after: { amount: '100.00', rationale: 'Revised evidence' },
    },
    sourceRevisionChanged: true,
    agreementChanged: true,
  })
})
it('first publication has no baseline; a missing or unrelated baseline fails closed', () => {
  expect(
    compareReceptionReview(null, { ...next(), previousReviewId: null }),
  ).toBeNull()
  expect(() => compareReceptionReview(null, next())).toThrow()
  expect(() =>
    compareReceptionReview({ ...prior(), id: id(99) }, next()),
  ).toThrow('RECEPTION_REVIEW_CHANGED')
  expect(() =>
    compareReceptionReview(prior(), { ...next(), previousReviewId: null }),
  ).toThrow('RECEPTION_REVIEW_CHANGED')
})
