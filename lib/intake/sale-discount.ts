export type DiscountUnit = 'percent' | 'amount'

/** Apply one discount to the catalogue price. Round the final price half up. */
export function discountedPriceOre(
  catalogueOre: bigint,
  input: string,
  unit: DiscountUnit,
): bigint | null {
  const value = input.trim()
  if (!value) return catalogueOre
  const match = /^(\d{1,9})(?:[.,](\d{0,2}))?$/.exec(value)
  if (!match) return null
  const hundredths =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  const result =
    unit === 'percent'
      ? (catalogueOre * (10_000n - hundredths) + 5_000n) / 10_000n
      : catalogueOre - hundredths
  return result > 0n ? result : null
}
