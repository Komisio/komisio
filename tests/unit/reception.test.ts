import { describe, expect, it } from 'vitest'
import {
  prepareReceptionProposal,
  prepareSellerReview,
  previewSellerDecision,
  receptionSuggestions,
} from '../../lib/engine/reception'
import { suggestReception } from '../../lib/assistance/reception'

const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const now = new Date('2026-09-12T00:00:00Z')
const session = {
  schemaVersion: 1,
  tenantId: id(1),
  sessionId: id(2),
  sellerId: id(3),
  revision: 1,
  sources: [
    {
      id: id(4),
      kind: 'observation',
      reference: 'Synthetic observation',
      observation: 'Blue jacket with visible tear',
    },
    {
      id: id(5),
      kind: 'price-evidence',
      reference: 'Synthetic store appraisal',
      observation: 'Fictional appraisal: 250.00 SEK',
    },
  ],
}
const candidate = {
  metadata: {
    description: {
      value: 'Blue jacket with visible tear',
      sourceIds: [id(4)],
      certainty: 'observed',
    },
  },
  price: {
    currency: 'SEK',
    amount: '250.00',
    rationale: 'Synthetic appraisal, not market evidence',
    sourceIds: [id(5)],
  },
  questions: [],
}
const terms = {
  versionId: id(6),
  body: 'TEST terms for review; no real contract.',
  language: 'en',
}
const seller = { tenantId: id(1), sellerId: id(3) }
const proposal = () => prepareReceptionProposal(session, candidate, id(7))
const review = () =>
  prepareSellerReview(
    session,
    proposal(),
    id(8),
    terms,
    '2026-09-13T00:00:00Z',
    now,
  )

describe('headless garment reception contract', () => {
  it('completes observation, assistance, review and seller decision without GUI or model dependency', async () => {
    // Explicit fixture adapter: this is not a live model or real market appraisal.
    const result = await suggestReception(
      session,
      id(7),
      { suggest: async () => candidate },
      new AbortController().signal,
    )
    expect(result.status).toBe('proposed')
    const prepared = prepareSellerReview(
      session,
      result.proposal,
      id(8),
      terms,
      '2026-09-13T00:00:00Z',
      now,
    )
    expect(prepared).toMatchObject({
      persisted: false,
      availableForSale: false,
    })
    expect(
      previewSellerDecision(
        session,
        prepared.review,
        { reviewId: id(8), decision: 'approve' },
        seller,
        now,
      ),
    ).toEqual({
      persisted: false,
      availableForSale: false,
      reviewId: id(8),
      decision: 'approve',
      requiresStoreAcceptance: true,
    })
    expect(prepared.review.terms).toEqual(terms)
  })
  it('supports decline without making a sale or recording physical return', () => {
    expect(
      previewSellerDecision(
        session,
        review().review,
        { reviewId: id(8), decision: 'decline' },
        seller,
        now,
      ),
    ).toMatchObject({
      decision: 'decline',
      persisted: false,
      availableForSale: false,
    })
  })
  it('leaves missing price and open questions explicit and prevents premature seller review', () => {
    const p = prepareReceptionProposal(
      session,
      { ...candidate, price: null, questions: ['Need price evidence'] },
      id(7),
    )
    expect(p.suggestions.price).toBeNull()
    expect(() =>
      prepareSellerReview(
        session,
        p,
        id(8),
        terms,
        '2026-09-13T00:00:00Z',
        now,
      ),
    ).toThrow('RECEPTION_REVIEW_INCOMPLETE')
  })
  it('does not silently convert uncertain suggestions into observed facts', () => {
    const p = prepareReceptionProposal(
      session,
      {
        ...candidate,
        metadata: {
          ...candidate.metadata,
          material: {
            value: 'Wool?',
            sourceIds: [id(4)],
            certainty: 'tentative',
          },
        },
      },
      id(7),
    )
    expect(() =>
      prepareSellerReview(
        session,
        p,
        id(8),
        terms,
        '2026-09-13T00:00:00Z',
        now,
      ),
    ).toThrow('RECEPTION_UNCERTAINTY_REQUIRES_REVIEW')
  })
  it('rejects invented evidence and photo-only pricing evidence', () => {
    expect(() =>
      prepareReceptionProposal(
        session,
        {
          ...candidate,
          metadata: {
            description: {
              ...candidate.metadata.description,
              sourceIds: [id(99)],
            },
          },
        },
        id(7),
      ),
    ).toThrow('RECEPTION_UNKNOWN_SOURCE')
    expect(() =>
      prepareReceptionProposal(
        session,
        { ...candidate, price: { ...candidate.price, sourceIds: [id(4)] } },
        id(7),
      ),
    ).toThrow('RECEPTION_PRICE_EVIDENCE_REQUIRED')
  })
  it('rejects model-supplied authority, terms and financial fields', () => {
    for (const extra of [
      { tenantId: id(99) },
      { sellerId: id(99) },
      { approved: true },
      { terms },
      { commission: 50 },
    ])
      expect(
        receptionSuggestions.safeParse({ ...candidate, ...extra }).success,
      ).toBe(false)
  })
  it('keeps decimal prices exact and rejects unsupported or malformed amounts', () => {
    for (const amount of [
      250,
      '250',
      '2.5',
      '1e3',
      '-1.00',
      '0.00',
      '1000000.00',
    ])
      expect(
        receptionSuggestions.safeParse({
          ...candidate,
          price: { ...candidate.price, amount },
        }).success,
      ).toBe(false)
    expect(
      receptionSuggestions.parse({
        ...candidate,
        price: { ...candidate.price, amount: '0.01' },
      }).price?.amount,
    ).toBe('0.01')
  })
  it('rejects late proposals and changed reception context', () => {
    for (const patch of [
      { tenantId: id(90) },
      { sessionId: id(90) },
      { sellerId: id(90) },
    ])
      expect(() =>
        prepareSellerReview(
          { ...session, ...patch },
          proposal(),
          id(8),
          terms,
          '2026-09-13T00:00:00Z',
          now,
        ),
      ).toThrow('RECEPTION_CONTEXT_CHANGED')
    expect(() =>
      prepareSellerReview(
        { ...session, revision: 2 },
        proposal(),
        id(8),
        terms,
        '2026-09-13T00:00:00Z',
        now,
      ),
    ).toThrow('RECEPTION_CHANGED')
  })
  it('requires the matching seller, current revision and exact review ID', () => {
    const r = review().review
    expect(() =>
      previewSellerDecision(
        session,
        r,
        { reviewId: id(8), decision: 'approve' },
        { ...seller, sellerId: id(90) },
        now,
      ),
    ).toThrow('RECEPTION_SELLER_MISMATCH')
    expect(() =>
      previewSellerDecision(
        session,
        r,
        { reviewId: id(90), decision: 'approve' },
        seller,
        now,
      ),
    ).toThrow('RECEPTION_REVIEW_CHANGED')
    expect(() =>
      previewSellerDecision(
        { ...session, revision: 2 },
        r,
        { reviewId: id(8), decision: 'approve' },
        seller,
        now,
      ),
    ).toThrow('RECEPTION_CHANGED')
  })
  it('expires at the exact boundary and rejects invalid clocks', () => {
    for (const clock of [new Date('2026-09-13T00:00:00Z'), new Date('invalid')])
      expect(() =>
        previewSellerDecision(
          session,
          review().review,
          { reviewId: id(8), decision: 'approve' },
          seller,
          clock,
        ),
      ).toThrow('RECEPTION_REVIEW_EXPIRED')
  })
  it('revalidates sources on review preparation, even for caller-created proposals', () => {
    const p = proposal()
    p.suggestions.price!.sourceIds = [id(99)]
    expect(() =>
      prepareSellerReview(
        session,
        p,
        id(8),
        terms,
        '2026-09-13T00:00:00Z',
        now,
      ),
    ).toThrow('RECEPTION_PRICE_EVIDENCE_REQUIRED')
  })
  it('is explicit when no model adapter is configured', async () => {
    expect(
      await suggestReception(
        session,
        id(7),
        null,
        new AbortController().signal,
      ),
    ).toEqual({ status: 'unavailable', proposal: null })
  })
  it('does not allow an adapter to mutate the trusted source set', async () => {
    await expect(
      suggestReception(
        session,
        id(7),
        {
          suggest: async (input) => {
            input.sources.push({
              id: id(99),
              kind: 'price-evidence',
              reference: 'Invented',
              observation: '',
            })
            return {
              ...candidate,
              price: { ...candidate.price, sourceIds: [id(99)] },
            }
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('RECEPTION_PRICE_EVIDENCE_REQUIRED')
    expect(session.sources).toHaveLength(2)
  })
  it('rejects a result if assistance was cancelled while running', async () => {
    const controller = new AbortController()
    await expect(
      suggestReception(
        session,
        id(7),
        {
          suggest: async () => {
            controller.abort()
            return candidate
          },
        },
        controller.signal,
      ),
    ).rejects.toThrow()
  })
})
