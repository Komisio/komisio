'use client'
import { useId, useState } from 'react'
import type { Dictionary, Locale } from '@/lib/i18n'
import type { SellerTypeTotals as Totals } from '@/lib/engine/seller-type-totals'
import { economyFormat } from '@/lib/intake/economy-format'

export function SellerTypeTotals({
  totals,
  d,
  labels,
  locale,
  currency,
}: {
  totals: Totals | null | undefined
  d: Dictionary['sellerDetails']['business']
  labels: Dictionary['economy']
  locale: Locale
  currency: string
}) {
  const id = useId()
  const [filter, setFilter] = useState('all')
  if (!totals) return null
  const format = economyFormat(locale)
  const fields = [
    ['grossOre', 'gross'],
    ['vatOre', 'vat'],
    ['sellerCreditOre', 'sellerCredit'],
    ['refundsOre', 'refunds'],
    ['creditReversedOre', 'creditReversed'],
    ['payoutsPaidOre', 'payoutsPaid'],
  ] as const
  return (
    <details className="seller-disclosure">
      <summary>{d.report}</summary>
      <div className="seller-disclosure-body">
        <div className="field">
          <label htmlFor={id}>{d.type}</label>
          <select
            id={id}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">{d.all}</option>
            <option value="private">{d.private}</option>
            <option value="business">{d.business}</option>
          </select>
        </div>
        {(['private', 'business'] as const)
          .filter((type) => filter === 'all' || filter === type)
          .map((type) => (
            <section key={type}>
              <h3>{d[type]}</h3>
              <dl className="economy-balances">
                {fields.map(([key, label]) => (
                  <div key={key}>
                    <dt>{labels[label]}</dt>
                    <dd>{format.money(totals[type]?.[key] ?? 0, currency)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
      </div>
    </details>
  )
}
