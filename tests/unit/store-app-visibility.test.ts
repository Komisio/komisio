import { describe, expect, it } from 'vitest'
import { syncVisibilityDraft } from '../../components/intake/store-app-visibility'

const v1 = '00000000-0000-4000-8000-000000000001'
const v2 = '00000000-0000-4000-8000-000000000002'

describe('store app visibility draft', () => {
  it('takes a newer version arriving through a refresh when unedited', () => {
    const draft = { base: v1, baseVisible: false, visible: false }
    expect(
      syncVisibilityDraft(draft, { id: v2, visible: true }, false),
    ).toEqual({
      base: v2,
      baseVisible: true,
      visible: true,
    })
  })

  it('keeps an edited draft on the version it was edited against', () => {
    const draft = { base: v1, baseVisible: true, visible: false }
    expect(syncVisibilityDraft(draft, { id: v2, visible: true }, false)).toBe(
      draft,
    )
  })

  it('keeps a submitted, unconfirmed change on its original version', () => {
    const draft = { base: v1, baseVisible: false, visible: false }
    expect(syncVisibilityDraft(draft, { id: v2, visible: true }, true)).toBe(
      draft,
    )
  })

  it('leaves the draft alone when the version is unchanged', () => {
    const draft = { base: null, baseVisible: false, visible: true }
    expect(
      syncVisibilityDraft(draft, { id: null, visible: false }, false),
    ).toBe(draft)
  })
})
