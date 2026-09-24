import { storeCountries } from './countries'

/** Owner-approved fixed prices for the same 100-credit pack, not FX rates. */
export const creditPrices = {
  SEK: { currency: 'SEK', amountMinor: 10000 },
  NOK: { currency: 'NOK', amountMinor: 10000 },
  DKK: { currency: 'DKK', amountMinor: 6500 },
  EUR: { currency: 'EUR', amountMinor: 900 },
  USD: { currency: 'USD', amountMinor: 1000 },
} as const
export type CreditCurrency = keyof typeof creditPrices
export type CreditPrice = (typeof creditPrices)[CreditCurrency]
export const creditPackOre = 10000
export function creditPriceForCountry(country?: string): CreditPrice {
  // Profiles created before country selection belong to the Swedish pilot.
  if (!country || country === 'SE') return creditPrices.SEK
  if (country === 'NO') return creditPrices.NOK
  if (country === 'DK') return creditPrices.DKK
  if (country === 'US') return creditPrices.USD
  if ((storeCountries as readonly string[]).includes(country))
    return creditPrices.EUR
  throw new Error('INVALID_INPUT')
}
export function formatCreditPrice(price: CreditPrice, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(price.amountMinor / 100)
}
