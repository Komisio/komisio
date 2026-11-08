import { describe, expect, it } from 'vitest'
import { statementOtherChanges } from '@/lib/intake/statement-summary'

describe('statement balance explanation', () => {
  it('keeps returns, payments and signed adjustments out of the other-events subtotal', () => {
    expect(
      statementOtherChanges({
        opening_ore: 50000,
        credited_ore: 20000,
        reversed_ore: 8000,
        paid_ore: 15000,
        adjustments_ore: -2500,
        closing_ore: 44500,
      }),
    ).toBe(0)
  })
  it('retains all reserved funds and fees from frozen totals without requiring loaded lines', () => {
    // An arbitrarily long statement can still be explained from its header.
    expect(
      statementOtherChanges({
        opening_ore: 50000,
        credited_ore: 20000,
        reversed_ore: 8000,
        paid_ore: 15000,
        adjustments_ore: -2500,
        closing_ore: 32000,
      }),
    ).toBe(-12500)
  })
})
