import { describe, expect, it } from 'vitest'
import {
  initialVisibilityDraft,
  savedVisibilityDraft,
  syncVisibilityDraft,
} from '../../components/intake/store-app-visibility'

const v1 = '00000000-0000-4000-8000-000000000001'
const v2 = '00000000-0000-4000-8000-000000000002'
const saved = '00000000-0000-4000-8000-000000000003'

describe('store app visibility draft', () => {
  it('takes a newer version arriving through a refresh when unedited', () => {
    const draft = initialVisibilityDraft({ id: v1, version: 1, visible: false })
    expect(
      syncVisibilityDraft(draft, { id: v2, version: 2, visible: true }, false),
    ).toEqual({ baseId: v2, baseVersion: 2, baseVisible: true, visible: true })
  })

  it('keeps an edited draft on the version it was edited against', () => {
    const draft = {
      ...initialVisibilityDraft({ id: v1, version: 1, visible: true }),
      visible: false,
    }
    expect(
      syncVisibilityDraft(draft, { id: v2, version: 2, visible: true }, false),
    ).toBe(draft)
  })

  it('keeps a submitted, unconfirmed change on its original version', () => {
    const draft = initialVisibilityDraft({ id: v1, version: 1, visible: false })
    expect(
      syncVisibilityDraft(draft, { id: v2, version: 2, visible: true }, true),
    ).toBe(draft)
  })

  it('keeps a confirmed save while the refresh is delayed, then edits on top of it', () => {
    const before = { id: v1, version: 1, visible: false }
    // Check the box and save; the write is confirmed before props refresh.
    const edited = { ...initialVisibilityDraft(before), visible: true }
    const confirmed = savedVisibilityDraft(edited, saved)
    expect(confirmed).toEqual({
      baseId: saved,
      baseVersion: 2,
      baseVisible: true,
      visible: true,
    })
    // The pre-save props render again: the saved value stays.
    expect(syncVisibilityDraft(confirmed, before, false)).toBe(confirmed)
    // A second edit before the refresh lands is based on the saved version.
    const again = {
      ...syncVisibilityDraft(confirmed, before, false),
      visible: false,
    }
    expect(again.baseId).toBe(saved)
    // The refresh catches up with the saved version: the edit is kept.
    expect(
      syncVisibilityDraft(
        again,
        { id: saved, version: 2, visible: true },
        false,
      ),
    ).toBe(again)
    // Unedited, the caught-up refresh changes nothing.
    expect(
      syncVisibilityDraft(
        confirmed,
        { id: saved, version: 2, visible: true },
        false,
      ),
    ).toBe(confirmed)
  })

  it('takes a later change by someone else after a confirmed save', () => {
    const before = { id: null, version: 0, visible: false }
    const confirmed = savedVisibilityDraft(
      { ...initialVisibilityDraft(before), visible: true },
      saved,
    )
    expect(confirmed.baseVersion).toBe(1)
    expect(syncVisibilityDraft(confirmed, before, false)).toBe(confirmed)
    expect(
      syncVisibilityDraft(
        confirmed,
        { id: v2, version: 2, visible: false },
        false,
      ),
    ).toEqual({
      baseId: v2,
      baseVersion: 2,
      baseVisible: false,
      visible: false,
    })
  })
})
