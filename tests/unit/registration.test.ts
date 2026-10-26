import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  defaultRegistration,
  registrationPreferences,
} from '../../lib/engine/registration'
import { attributeVocabulary, questionsFor } from '../../lib/engine/attributes'
import {
  manualReceptionSources,
  readManualReception,
} from '../../lib/engine/manual-reception'
import { quickFacts, quickReceive } from '../../lib/engine/quick-intake'
import { executeIntake } from '../../lib/engine/intake'

const vocabulary = attributeVocabulary.parse({
  definitions: ['description', 'brand', 'size', 'socket'].map((slug) => ({
    slug,
    version: 1,
    data_type: 'text',
    unit: '',
    choices: [],
    labels: { en: slug },
    help: {},
    active: true,
    own: false,
  })),
  types: [
    {
      slug: 'lamp',
      labels: { en: 'Lamp' },
      suggested_category: '',
      active: true,
      own: false,
      inherit_attributes: true,
      attributes: [{ slug: 'socket', expected: true, sort: 0 }],
    },
  ],
  registration: { id: null, settings: defaultRegistration },
})
it('applies store defaults to existing and new inheriting types and the no-type form', () => {
  for (const type of ['lamp', null, 'not_yet_created'])
    expect(
      questionsFor(vocabulary, type).map((q) => q.definition.slug),
    ).toEqual(['description', 'brand', 'size'])
  const overridden = {
    ...vocabulary,
    types: [{ ...vocabulary.types[0], inherit_attributes: false }],
  }
  expect(
    questionsFor(overridden, 'lamp').map((q) => q.definition.slug),
  ).toEqual(['description', 'socket'])
  expect(
    questionsFor(
      { ...overridden, types: [{ ...overridden.types[0], attributes: [] }] },
      'lamp',
    ).map((q) => q.definition.slug),
  ).toEqual(['description'])
})
it('description requirement is identical for inherited, custom and unselected types', () => {
  for (const required of [false, true])
    for (const inherit of [false, true]) {
      const v = {
        ...vocabulary,
        types: [{ ...vocabulary.types[0], inherit_attributes: inherit }],
        registration: {
          id: null,
          settings: { ...defaultRegistration, descriptionRequired: required },
        },
      }
      for (const type of ['lamp', null])
        expect(questionsFor(v, type)[0].expected).toBe(required)
    }
})
it('accepts only bounded literal templates and known placeholders', () => {
  expect(
    registrationPreferences.safeParse({
      ...defaultRegistration,
      titleTemplate: '{type} – {brand} ({size})',
    }).success,
  ).toBe(true)
  for (const titleTemplate of [
    '{internalNote}',
    '{seller.email}',
    '{size',
    '{type}\n{brand}',
    '',
  ])
    expect(
      registrationPreferences.safeParse({
        ...defaultRegistration,
        titleTemplate,
      }).success,
    ).toBe(false)
  expect(
    registrationPreferences.safeParse({
      ...defaultRegistration,
      attributes: ['brand', 'brand'],
    }).success,
  ).toBe(false)
})
it('manual reception keeps missing description absent while preserving price and attribute evidence', () => {
  const sourceId = crypto.randomUUID()
  const sources = manualReceptionSources(
    [],
    {
      description: '',
      amount: '200.00',
      reference: 'Appraisal',
      rationale: 'Staff price',
      attributes: [
        { slug: 'brand', definitionVersion: 1, value: 'Synthetic', sourceId },
      ],
    },
    crypto.randomUUID(),
    crypto.randomUUID(),
  )
  expect(
    sources.some((s) => s.reference === 'komisio:manual-description:v1'),
  ).toBe(false)
  const decoded = readManualReception(sources)!
  expect(decoded.input.description).toBe('')
  expect(decoded.suggestions.price?.amount).toBe('200.00')
  expect(decoded.suggestions.attributes).toEqual([
    {
      slug: 'brand',
      definitionVersion: 1,
      value: 'Synthetic',
      sourceIds: [sourceId],
      certainty: 'observed',
    },
  ])
  expect(quickFacts.parse({ brand: 'Synthetic' })).toEqual({
    brand: 'Synthetic',
  })
})
it('quick registration sends the private note outside facts in one database call', async () => {
  const id = crypto.randomUUID(),
    rpc = vi.fn().mockResolvedValue({
      data: {
        itemId: id,
        sessionId: id,
        garmentId: id,
        reference: 'I-TEST',
        reviewVersion: 1,
      },
      error: null,
    })
  await quickReceive({ rpc } as unknown as SupabaseClient, {
    tenantId: id,
    requestId: id,
    sellerId: id,
    sessionId: id,
    expectedRevision: 0,
    facts: { brand: 'Synthetic' },
    priceOre: 20000,
    internalNote: 'PRIVATE stain',
  })
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith(
    'quick_receive_noted',
    expect.objectContaining({
      p_note: 'PRIVATE stain',
      p_facts: { brand: 'Synthetic' },
      p_category: null,
      p_bag: null,
    }),
  )
})
it('preserves an own-stock type even when no optional attributes were supplied', async () => {
  const id = crypto.randomUUID(),
    rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  await executeIntake({ rpc } as unknown as SupabaseClient, {
    action: 'registerPurchase',
    tenantId: id,
    requestId: id,
    supplierNote: '',
    purchasePrice: '100.00',
    evidenceReference: 'Synthetic receipt',
    marginEligible: false,
    itemType: 'jacket',
  })
  expect(rpc).toHaveBeenCalledWith(
    'register_purchase_described',
    expect.objectContaining({
      p_item_type: 'jacket',
      p_facts: {},
      p_internal_note: '',
    }),
  )
})
