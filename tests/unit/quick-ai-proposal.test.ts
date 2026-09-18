import { expect, it } from 'vitest'
import { quickAiProposal } from '../../lib/intake/quick-ai-proposal'

const sourceIds = ['10000000-0000-4000-8000-000000000001']
const proposal = {
  itemType: 'lamp',
  attributes: [
    ['description', 'Svart bordslampa med kupad skärm och rund fot'],
    ['color', 'svart'],
    ['socket', 'e27'],
    ['dimmable', 'false'],
  ].map(([slug, value]) => ({
    slug,
    value,
    definitionVersion: 1,
    sourceIds,
    certainty: 'tentative',
  })),
  price: null,
  questions: ['Hur hög är lampan?'],
}

it('fills the current attribute-only AI response including type and dynamic fields', () => {
  expect(quickAiProposal(proposal)).toEqual({
    facts: {
      description: 'Svart bordslampa med kupad skärm och rund fot',
      color: 'svart',
      socket: 'e27',
      dimmable: 'false',
    },
    itemType: 'lamp',
    price: '',
  })
  expect(proposal.attributes[0].certainty).toBe('tentative')
})

it('keeps an evidenced price exact and clears absent type and price', () => {
  expect(
    quickAiProposal({
      ...proposal,
      price: {
        currency: 'SEK',
        amount: '250.00',
        rationale: 'Provided price evidence',
        sourceIds,
      },
    }).price,
  ).toBe('250.00')
  expect(
    quickAiProposal({ attributes: [], price: null, questions: [] }),
  ).toEqual({ facts: { description: '' }, price: '', itemType: null })
})

it('rejects the retired metadata-only response instead of announcing filled fields', () => {
  expect(() =>
    quickAiProposal({ metadata: {}, price: null, questions: [] }),
  ).toThrow()
})
