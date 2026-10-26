import Link from '@/components/platform/working-link'
import type { ReactNode } from 'react'
import { EventTime } from '@/components/ui/event-time'
import { formatOre } from '@/lib/engine/items'
import { formatSignedOre, type LedgerEntry } from '@/lib/engine/seller-ledger'
import { intlLocale, type Dictionary, type Locale } from '@/lib/i18n'

/** Display the paged ledger facts as supplied; never infer balances from a page. */
export function SellerLedgerTable({
  entries,
  currency,
  locale,
  d,
}: {
  entries: LedgerEntry[]
  currency: string
  locale: Locale
  d: Dictionary
}) {
  const labels = d.ledger.table
  const columns = [
    labels.date,
    labels.event,
    labels.item,
    d.statements.salePrice,
    d.itemWorkflow.storeShare,
    d.itemWorkflow.sellerShare,
    labels.amount,
  ]
  const money = (decimal: string, signed = false) => {
    const formatter = new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: signed ? 'exceptZero' : 'auto',
    })
    // Intl accepts exact decimal strings; the TypeScript lib omits that overload.
    return (formatter.format as unknown as (value: string) => string)(decimal)
  }
  const cell = (
    label: string,
    content: ReactNode,
    numeric = false,
    empty = false,
  ) => (
    <td
      role="cell"
      aria-colindex={columns.indexOf(label) + 1}
      className={`${numeric ? 'ledger-number' : ''}${empty ? ' ledger-empty' : ''}`}
    >
      <span className="ledger-mobile-label" aria-hidden="true">
        {label}
      </span>
      <div className="ledger-cell-value">{content}</div>
    </td>
  )
  return (
    <div className="seller-ledger-table-wrap">
      <table
        className="seller-ledger-table"
        role="table"
        aria-colcount={columns.length}
        aria-label={d.sellerProfile.transactions}
      >
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((label, index) => (
              <th
                key={label}
                scope="col"
                role="columnheader"
                className={index >= 3 ? 'ledger-number' : undefined}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {entries.map((entry) => {
            const item = entry.itemDetails
            const sale = entry.kind === 'credit_sale' ? item : null
            const payout =
              entry.reference_kind === 'payout' &&
              entry.kind.startsWith('payout_')
            return (
              <tr key={entry.id} role="row">
                {cell(
                  labels.date,
                  <EventTime value={entry.occurred_at} locale={locale} />,
                )}
                {cell(
                  labels.event,
                  <>
                    <span className="ledger-event-kind">
                      {d.ledger.kinds[entry.kind]}
                    </span>
                    {entry.reason && (
                      <p className="ledger-event-note">{entry.reason}</p>
                    )}
                    {payout && (
                      <small className="ledger-payout-reference">
                        {labels.payoutReference}
                        <code>{entry.reference_id}</code>
                      </small>
                    )}
                  </>,
                )}
                {cell(
                  labels.item,
                  item ? (
                    <Link
                      href={`/intake/items/${item.itemId}`}
                      className="ledger-item-link"
                    >
                      <span
                        className="ledger-item-title"
                        title={item.title || item.reference}
                      >
                        {item.title || item.reference}
                      </span>
                      <small>{item.reference}</small>
                    </Link>
                  ) : (
                    '—'
                  ),
                  false,
                  !item,
                )}
                {cell(
                  d.statements.salePrice,
                  sale ? money(formatOre(sale.salePriceOre)) : '—',
                  true,
                  !sale,
                )}
                {cell(
                  d.itemWorkflow.storeShare,
                  sale ? money(formatOre(sale.storeShareOre)) : '—',
                  true,
                  !sale,
                )}
                {cell(
                  d.itemWorkflow.sellerShare,
                  sale ? money(formatOre(sale.sellerShareOre)) : '—',
                  true,
                  !sale,
                )}
                {cell(
                  labels.amount,
                  <strong>
                    {money(formatSignedOre(entry.amount_ore), true)}
                  </strong>,
                  true,
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
