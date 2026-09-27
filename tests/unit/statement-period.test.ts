import { describe, expect, it } from 'vitest'
import {
  statementPeriodDefaults,
  statementPeriodDates,
} from '../../lib/intake/statement-period'

describe('closed statement calendar periods', () => {
  it.each([
    ['2026-09-27T12:00:00Z', '2026-09-01', '2026-09-26'],
    ['2026-10-01T00:30:00Z', '2026-09-01', '2026-09-30'],
    ['2027-01-01T00:30:00Z', '2026-12-01', '2026-12-31'],
    ['2026-09-30T22:30:00Z', '2026-09-01', '2026-09-30'],
    ['2024-03-01T12:00:00Z', '2024-02-01', '2024-02-29'],
  ])('defaults to a closed Stockholm period at %s', (now, from, to) => {
    expect(statementPeriodDefaults(new Date(now))).toEqual({ from, to })
    expect(statementPeriodDates(from, to, new Date(now)).periodTo <= now).toBe(
      true,
    )
  })
  it('keeps selected days unchanged for database timezone conversion', () => {
    expect(
      statementPeriodDates(
        '2026-03-29',
        '2026-03-29',
        new Date('2027-01-01T12:00:00Z'),
      ),
    ).toEqual({
      periodFrom: '2026-03-29',
      periodTo: '2026-03-29',
      calendar: 'stockholm-days',
    })
  })
  it.each([
    ['2026-09-27', '2026-09-27'],
    ['2026-09-28', '2026-09-29'],
    ['2026-09-26', '2026-09-25'],
    ['2026-02-30', '2026-03-01'],
    ['', '2026-09-01'],
  ])('rejects open or invalid period %s to %s', (from, to) => {
    expect(() =>
      statementPeriodDates(from, to, new Date('2026-09-27T12:00:00Z')),
    ).toThrow()
  })
})
