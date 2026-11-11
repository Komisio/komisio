/** Exact decimal input to integer öre; no binary floating-point calculation. */
export function externalOfferOre(input: string): string | null {
  const text = input.trim().replace(',', '.')
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return value > 0n && value <= 99999999999n ? String(value) : null
}
export function externalOfferAmount(ore: string) {
  if (!/^\d{1,11}$/.test(ore)) throw new Error('INVALID_INPUT')
  const value = BigInt(ore)
  const fraction = value % 100n
  return `${value / 100n}${fraction ? `,${String(fraction).padStart(2, '0')}` : ''} SEK`
}
