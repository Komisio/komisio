import type { ComponentProps } from 'react'
import { intlLocale } from '@/lib/i18n'

/** Currency is presentation only; the existing form keeps its exact price parser. */
export function PriceInput({
  currency,
  locale,
  ...input
}: ComponentProps<'input'> & {
  id: string
  currency: string
  locale: string
}) {
  const symbol =
    new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  const currencyId = `${input.id}-currency`
  return (
    <div className="price-input">
      <input
        {...input}
        aria-describedby={[input['aria-describedby'], currencyId]
          .filter(Boolean)
          .join(' ')}
      />
      <span id={currencyId} aria-label={currency} title={currency}>
        {symbol}
      </span>
    </div>
  )
}
