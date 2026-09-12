import { describe, expect, it } from 'vitest'
import {
  prepareInspectionReception,
  inspectionReceptionInput,
} from '../../lib/engine/inspection-reception-preview'
import { receptionSuggestions } from '../../lib/engine/reception'

const draft = {
  bagId: '10000000-0000-4000-8000-000000000001',
  draftId: '10000000-0000-4000-8000-000000000002',
  revision: 3,
  archived: false,
  fields: {
    description: 'Red coat',
    category: 'Clothes',
    condition: 'Needs inspection',
  },
}
describe('inspection to reception preparation', () => {
  it('preserves saved provenance and text without manufacturing reception evidence', () => {
    const before = structuredClone(draft)
    const result = prepareInspectionReception(draft)
    expect(result.origin).toEqual({
      kind: 'inspection-draft-revision',
      bagId: draft.bagId,
      draftId: draft.draftId,
      revision: 3,
    })
    expect(result.candidates.map((c) => [c.field, c.value])).toEqual([
      ['description', 'Red coat'],
      ['category', 'Clothes'],
      ['condition', 'Needs inspection'],
    ])
    expect(
      result.candidates.every((c) => c.requiresSource && c.requiresFactReview),
    ).toBe(true)
    expect(result).toMatchObject({
      persisted: false,
      staged: false,
      approved: false,
      availableForSale: false,
      readyToPublish: false,
      evidenceIsUntrusted: true,
      otherRecordsChecked: false,
    })
    expect(receptionSuggestions.safeParse(result).success).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(
      /sourceIds|sellerId|agreementId|certainty/,
    )
    expect(draft).toEqual(before)
  })
  it('omits empty optional fields without declaring them required', () => {
    const result = prepareInspectionReception({
      ...draft,
      fields: { description: 'Only description', category: ' ', condition: '' },
    })
    expect(result.candidates.map((c) => c.field)).toEqual(['description'])
    expect(result.stepsToCheck).toContain('review_sourced_price')
  })
  it('rejects archive and empty description', () => {
    expect(() =>
      prepareInspectionReception({ ...draft, archived: true }),
    ).toThrow('INSPECTION_ARCHIVED')
    expect(() =>
      prepareInspectionReception({
        ...draft,
        fields: { ...draft.fields, description: ' ' },
      }),
    ).toThrow('INSPECTION_DESCRIPTION_REQUIRED')
  })
  it('does not accept unsaved revisions or injected financial and identity fields', () => {
    for (const input of [
      { ...draft, revision: 0 },
      { ...draft, revision: 1.5 },
      { ...draft, approved: true },
      { ...draft, sellerId: draft.draftId },
      { ...draft, fields: { ...draft.fields, price: '100.00' } },
    ])
      expect(() => prepareInspectionReception(input)).toThrow()
    expect(
      inspectionReceptionInput.safeParse({
        bagId: draft.bagId,
        draftId: draft.draftId,
        expectedRevision: 3,
        fields: draft.fields,
      }).success,
    ).toBe(false)
  })
})
