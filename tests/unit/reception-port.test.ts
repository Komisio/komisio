import { expect, it, vi } from 'vitest'
import { suggestReception } from '../../lib/assistance/reception'
import { prepareSellerReview } from '../../lib/engine/reception'
import { reviewReceptionFacts } from '../../lib/engine/reception-fact-review'

const id = (n: number) =>
  `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const session = {
  schemaVersion: 1,
  tenantId: id(1),
  sessionId: id(2),
  sellerId: id(3),
  revision: 7,
  sources: [
    {
      id: id(4),
      kind: 'photo',
      reference: `${id(1)}/${id(2)}/private.jpg`,
      observation: 'Jacket label',
    },
    {
      id: id(5),
      kind: 'price-evidence',
      reference: 'Staff supplied appraisal',
      observation: '100.00 SEK',
    },
  ],
}
const candidate = () => ({
  metadata: {
    description: {
      value: 'Blue jacket',
      sourceIds: [id(4)],
      certainty: 'observed',
    },
  },
  price: {
    currency: 'SEK',
    amount: '100.00',
    rationale: 'Staff supplied appraisal',
    sourceIds: [id(5)],
  },
  questions: [],
})
const signal = () => new AbortController().signal
it('minimizes evidence for every adapter before provider-specific code runs', async () => {
  const suggest = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(candidate())
  const result = await suggestReception(session, id(6), { suggest }, signal())
  const evidence = suggest.mock.calls[0][0]
  expect(evidence).toEqual({
    sources: [
      { id: id(4), kind: 'photo', observation: 'Jacket label' },
      session.sources[1],
    ],
  })
  const serialized = JSON.stringify(evidence)
  for (const privateValue of [
    id(1),
    id(2),
    id(3),
    'private.jpg',
    'revision',
    'schemaVersion',
  ])
    expect(serialized).not.toContain(privateValue)
  expect(result.proposal).toMatchObject({
    tenantId: id(1),
    sessionId: id(2),
    sellerId: id(3),
    baseRevision: 7,
  })
  expect(session.sources[0].reference).toContain('private.jpg')
})
it('a replacement adapter cannot claim staff review by returning observed facts', async () => {
  const original = candidate()
  const { proposal } = await suggestReception(
    session,
    id(6),
    { suggest: async () => original },
    signal(),
  )
  expect(proposal!.suggestions.metadata.description!.certainty).toBe(
    'tentative',
  )
  expect(original.metadata.description.certainty).toBe('observed')
  const terms = { versionId: id(7), body: 'TEST terms', language: 'en' }
  const prepare = (p: unknown) =>
    prepareSellerReview(
      session,
      p,
      id(8),
      terms,
      '2099-01-01T00:00:00Z',
      new Date('2026-09-12'),
    )
  expect(() => prepare(proposal)).toThrow(
    'RECEPTION_UNCERTAINTY_REQUIRES_REVIEW',
  )
  const reviewed = reviewReceptionFacts(proposal!.suggestions, [
    'description',
    'price',
  ])
  expect(reviewed.complete).toBe(true)
  expect(
    prepare({ ...proposal, suggestions: reviewed.suggestions })
      .availableForSale,
  ).toBe(false)
})
it('normalization does not silently strip an injected identity or authority', async () => {
  for (const extra of [
    { tenantId: id(99) },
    { approved: true },
    { baseRevision: 999 },
  ])
    await expect(
      suggestReception(
        session,
        id(6),
        { suggest: async () => ({ ...candidate(), ...extra }) },
        signal(),
      ),
    ).rejects.toThrow()
})
