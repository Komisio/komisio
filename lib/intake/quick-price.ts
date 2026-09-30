/** Decimal entry to integer minor units, within quick intake's existing limit.
 * Keep arithmetic on integers; reject excess decimals instead of rounding them. */
export function quickPriceOre(input: string): number | null {
  const match = /^(\d+)(?:[.,](\d{0,2}))?$/.exec(input.trim())
  if (!match) return null
  const major = Number(match[1])
  if (!Number.isSafeInteger(major) || major > 999_999) return null
  const ore = major * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return ore > 0 && ore <= 99_999_999 ? ore : null
}
