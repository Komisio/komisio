import { describe, expect, it } from 'vitest'
import {
  reviewReceptionFacts,
  receptionReviewFields,
} from '../../lib/engine/reception-fact-review'
const source = '10000000-0000-4000-8000-000000000001'
const candidate = {
  metadata: {
    description: { value: 'Coat', sourceIds: [source], certainty: 'observed' },
    condition: {
      value: 'Unverified wear',
      sourceIds: [source],
      certainty: 'tentative',
    },
  },
  price: {
    currency: 'SEK',
    amount: '250.00',
    rationale: 'Test appraisal',
    sourceIds: [source],
  },
  questions: [],
}
describe('explicit reception fact review', () => {
  it('lets staff confirm an attribute the seven fixed keys have no room for', () => {
    // A lamp. Before the attribute list, a socket could not be reviewed
    // because it could not be carried, and staff confirmed a description
    // while the socket travelled unseen.
    const lamp = {
      metadata: {},
      attributes: [
        {
          slug: 'description',
          definitionVersion: 1,
          value: 'Brass table lamp',
          sourceIds: [source],
          certainty: 'tentative' as const,
        },
        {
          slug: 'socket',
          definitionVersion: 1,
          value: 'e27',
          sourceIds: [source],
          certainty: 'tentative' as const,
        },
      ],
      price: {
        currency: 'SEK',
        amount: '250.00',
        rationale: 'Comparable lamps',
        sourceIds: [source],
      },
      questions: [],
    }
    expect(receptionReviewFields(lamp)).toEqual([
      'description',
      'socket',
      'price',
    ])
    const partly = reviewReceptionFacts(lamp, ['description', 'price'])
    expect(partly.complete).toBe(false)
    expect(
      partly.suggestions.attributes?.find((a) => a.slug === 'socket')
        ?.certainty,
    ).toBe('tentative')
    const all = reviewReceptionFacts(lamp, ['description', 'socket', 'price'])
    expect(all.complete).toBe(true)
    expect(
      all.suggestions.attributes?.every((a) => a.certainty === 'observed'),
    ).toBe(true)
  })

  it('refuses a confirmation for something the candidate never proposed', () => {
    expect(() => reviewReceptionFacts(candidate, ['socket'])).toThrow(
      'RECEPTION_REVIEW_SELECTION_INVALID',
    )
  })

  it('does not treat model observed certainty as staff confirmation', () => {
    const result = reviewReceptionFacts(candidate, [])
    expect(result.complete).toBe(false)
    expect(
      Object.values(result.suggestions.metadata).every(
        (f) => f?.certainty === 'tentative',
      ),
    ).toBe(true)
    expect(receptionReviewFields(candidate)).toEqual([
      'description',
      'condition',
      'price',
    ])
  })
  it('confirms only selected fields and requires separate price review', () => {
    const partial = reviewReceptionFacts(candidate, ['description'])
    expect(partial.suggestions.metadata.description?.certainty).toBe('observed')
    expect(partial.suggestions.metadata.condition?.certainty).toBe('tentative')
    expect(partial.complete).toBe(false)
    expect(
      reviewReceptionFacts(candidate, ['description', 'condition']).complete,
    ).toBe(false)
    const before = structuredClone(candidate)
    const complete = reviewReceptionFacts(candidate, [
      'description',
      'condition',
      'price',
    ])
    expect(complete.complete).toBe(true)
    expect(complete.suggestions.price).toEqual(candidate.price)
    expect(complete.suggestions.metadata.description?.sourceIds).toEqual([
      source,
    ])
    expect(candidate).toEqual(before)
  })
  it('does not resolve questions or invent a missing description or price', () => {
    expect(
      reviewReceptionFacts({ ...candidate, questions: ['Verify material'] }, [
        'description',
        'condition',
        'price',
      ]).complete,
    ).toBe(false)
    expect(
      reviewReceptionFacts({ ...candidate, price: null }, [
        'description',
        'condition',
      ]).complete,
    ).toBe(false)
    expect(
      reviewReceptionFacts(
        { ...candidate, metadata: { condition: candidate.metadata.condition } },
        ['condition', 'price'],
      ).complete,
    ).toBe(false)
  })
  it('rejects absent, duplicate and authority selections', () => {
    for (const selection of [
      ['brand'],
      ['description', 'description'],
      ['approved'],
      { fields: ['description'], price: true },
    ])
      expect(() => reviewReceptionFacts(candidate, selection)).toThrow()
    expect(() =>
      reviewReceptionFacts({ ...candidate, tenantId: source }, []),
    ).toThrow()
  })
})
