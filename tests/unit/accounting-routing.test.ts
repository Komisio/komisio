import { describe, expect, it } from 'vitest'
import { previewAccountingRouting } from '../../lib/accounting/routing-preview'

describe('unsaved accounting responsibility preview', () => {
  const voucher = { balanced: true, unmapped: [], lines: [{}] }
  it('flags duplicate sales even when the existing voucher balances', () => {
    const result = previewAccountingRouting('komisio', 'enabled', voucher)
    expect(result.issues).toContain('duplicateSales')
    expect(result.owners.sales).toBe('komisio')
    expect(result.executable).toBe(false)
  })
  it('does not mistake a balanced full voucher for a complementary journal', () => {
    const result = previewAccountingRouting('pos', 'enabled', voucher)
    expect(result.issues).toContain('complementUnavailable')
    expect(result.owners.sales).toBe('pos')
    expect(result.owners.sellerCredit).toBe('komisio')
    expect(result.executable).toBe(false)
  })
  it('distinguishes missing external sales from an unverified external setup', () => {
    expect(
      previewAccountingRouting('pos', 'disabled', voucher).issues,
    ).toContain('missingSales')
    expect(
      previewAccountingRouting('pos', 'unknown', voucher).issues,
    ).toContain('externalUnknown')
    expect(
      previewAccountingRouting('komisio', 'unknown', voucher).issues,
    ).toContain('externalUnknown')
  })
  it('keeps manual review separate from automatic responsibility', () => {
    const result = previewAccountingRouting('manual', 'enabled', voucher)
    expect(
      Object.values(result.owners).every((owner) => owner === 'accountant'),
    ).toBe(true)
    expect(result.issues).not.toContain('duplicateSales')
    expect(result.issues).toContain('manualReview')
  })
  it('reports missing or unusable current voucher facts without mutating them', () => {
    expect(
      previewAccountingRouting('komisio', 'disabled', null).issues,
    ).toContain('noClose')
    const broken = Object.freeze({
      balanced: false,
      unmapped: Object.freeze(['grossOre']),
      lines: Object.freeze([{}]),
    })
    const result = previewAccountingRouting('komisio', 'disabled', broken)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'unbalanced',
        'unmapped',
        'coverage',
        'cutover',
        'review',
      ]),
    )
    expect(broken.unmapped).toEqual(['grossOre'])
  })
  it('describes an empty voucher instead of claiming that zero totals differ', () => {
    const result = previewAccountingRouting('komisio', 'disabled', {
      balanced: false,
      unmapped: [],
      lines: [],
    })
    expect(result.issues).toContain('emptyVoucher')
    expect(result.issues).not.toContain('unbalanced')
  })
  it('never yields an activation grant for any mode or external setting', () => {
    for (const mode of ['komisio', 'pos', 'manual'] as const)
      for (const external of ['unknown', 'enabled', 'disabled'] as const) {
        const result = previewAccountingRouting(mode, external, voucher)
        expect(result.executable).toBe(false)
        expect(result.issues.length).toBeGreaterThan(0)
      }
  })
})
