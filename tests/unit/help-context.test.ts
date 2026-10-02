import { describe, expect, it } from 'vitest'
import { helpTopicForPage } from '../../lib/help/topics'

describe('task-specific help routing', () => {
  it('offers general integration help when no provider is selected', () => {
    expect(helpTopicForPage('/intake/integrations', null, null)).toBe(
      'integrations',
    )
  })
  it('distinguishes custody and item labels from preparation routes', () => {
    expect(helpTopicForPage('/intake/bags/a', null, null)).toBe('labels')
    expect(helpTopicForPage('/intake/bags/a/inspect', null, null)).toBe(
      'receiving',
    )
    expect(helpTopicForPage('/intake/reception/a', null, null)).toBe(
      'receiving',
    )
    expect(helpTopicForPage('/intake/reception/a/label', null, null)).toBe(
      'labels',
    )
    expect(helpTopicForPage('/intake/items/a/label', null, null)).toBe('labels')
  })
  it('selects printing help only for the printing settings tab', () => {
    expect(helpTopicForPage('/settings', null, 'printing')).toBe('labels')
    expect(helpTopicForPage('/settings', null, 'store')).toBeNull()
    expect(helpTopicForPage('/settings', null, null)).toBeNull()
  })
  it('retains accounting context without claiming unsupported detail pages', () => {
    expect(helpTopicForPage('/intake/accounting', 'settings', null)).toBe(
      'fortnox-connect',
    )
    expect(helpTopicForPage('/intake/accounting', 'reconciliation', null)).toBe(
      'fortnox-recovery',
    )
    expect(helpTopicForPage('/intake/accounting', null, null)).toBe(
      'fortnox-first-export',
    )
    for (const path of [
      '/intake/accounting-other',
      '/intake/integrations/other',
      '/intake/reception/a/history',
      '/seller',
      '/help/labels',
    ]) {
      expect(helpTopicForPage(path, null, null)).toBeNull()
    }
  })
})
