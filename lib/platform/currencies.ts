export const storeCurrencies = ['SEK', 'NOK', 'DKK', 'EUR', 'USD'] as const

/** A suggestion only: onboarding lets the owner choose independently of language. */
export function suggestedStoreCurrency(locale: string) {
  return locale === 'sv'
    ? 'SEK'
    : locale === 'no'
      ? 'NOK'
      : locale === 'dk'
        ? 'DKK'
        : 'EUR'
}
