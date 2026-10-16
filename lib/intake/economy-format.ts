import { intlLocale, type Locale } from '@/lib/i18n'
import { formatSignedOre } from '@/lib/engine/seller-ledger'

/** Presentation only: retain the exact minor units supplied by the read model. */
export function economyFormat(locale: Locale) {
  const tag = intlLocale(locale)
  const numbers = new Intl.NumberFormat(tag)
  const dates = new Intl.DateTimeFormat(tag, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  })
  const parts = dates.formatToParts(new Date('2006-11-22T00:00:00Z'))
  return {
    number: (value: number) => numbers.format(value),
    money: (ore: number, currency: string) => {
      const formatter = new Intl.NumberFormat(tag, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      // Intl accepts exact decimal strings; TypeScript's older lib types omit them.
      const format = formatter.format as unknown as (value: string) => string
      return format(formatSignedOre(ore))
    },
    date: (iso: string) => dates.format(new Date(`${iso}T00:00:00Z`)),
    parseDate: (value: string): string | null => {
      const fields = parts.filter((p) => p.type !== 'literal')
      const pattern = parts
        .map((p) =>
          p.type === 'literal'
            ? p.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            : p.type === 'year'
              ? '(\\d{4})'
              : '(\\d{2})',
        )
        .join('')
      const match = new RegExp(`^${pattern}$`).exec(value.trim())
      if (!match) return null
      const values = Object.fromEntries(
        fields.map((p, i) => [p.type, match[i + 1]]),
      )
      const iso = `${values.year}-${values.month}-${values.day}`
      const parsed = new Date(`${iso}T00:00:00Z`)
      return Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === iso
        ? iso
        : null
    },
  }
}
