import { describe, expect, it } from 'vitest'
import { economyFormat } from '@/lib/intake/economy-format'
import { locales } from '@/lib/i18n'

const spaces = (value: string) => value.replace(/\s/g, ' ')

describe('economy presentation', () => {
  it('formats exact minor units, including negative and large amounts', () => {
    expect(spaces(economyFormat('sv').money(128000, 'SEK'))).toBe('1 280,00 kr')
    expect(spaces(economyFormat('en').money(-1, 'USD'))).toBe('-US$0.01')
    expect(
      spaces(economyFormat('en').money(Number.MAX_SAFE_INTEGER, 'USD')),
    ).toBe('US$90,071,992,547,409.91')
    expect(spaces(economyFormat('de').money(128000, 'EUR'))).toBe('1.280,00 €')
  })

  it.each(locales)(
    'round-trips dates and rejects impossible dates in %s',
    (locale) => {
      const format = economyFormat(locale)
      for (const iso of ['2026-10-01', '2024-02-29', '2025-12-31']) {
        expect(format.parseDate(format.date(iso))).toBe(iso)
      }
      expect(format.parseDate('')).toBeNull()
      expect(
        format.parseDate(format.date('2024-02-29').replace('2024', '2025')),
      ).toBeNull()
      expect(
        format.parseDate(format.date('2026-10-01') + ' trailing'),
      ).toBeNull()
    },
  )

  it('uses the selected language rather than the browser default', () => {
    expect(economyFormat('sv').date('2026-10-01')).toBe('2026-10-01')
    expect(economyFormat('en').date('2026-10-01')).toBe('01/10/2026')
    expect(economyFormat('dk').date('2026-10-01')).toBe('01.10.2026')
  })

  it('formats report percentages without changing their scale or dropping decimals', () => {
    expect(spaces(economyFormat('sv').percent(60))).toBe('60 %')
    expect(spaces(economyFormat('sv').percent(12.34))).toBe('12,34 %')
    expect(economyFormat('en').percent(-0.5)).toBe('-0.5%')
  })

  it.each(locales)('formats complete calendar-date ranges in %s', (locale) => {
    const format = economyFormat(locale)
    const range = format.dateRange('2026-10-01', '2026-10-31')
    expect(range).toContain('2026')
    expect(range).not.toContain('2026-10-01')
    expect(range).not.toContain('2026-10-31')
    expect(format.dateRange('2024-12-31', '2025-01-01')).toContain('2024')
    expect(format.dateRange('2024-12-31', '2025-01-01')).toContain('2025')
  })
})
