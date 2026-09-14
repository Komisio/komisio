import Link from 'next/link'
import type { Dictionary } from '@/lib/i18n'
import type { PriceEvidence } from '@/lib/engine/price-evidence'
import { formatSignedOre } from '@/lib/engine/seller-ledger'

/** Comparable sales in this store; a server component, read only. */
export function PriceEvidencePanel({
  evidence,
  formAction,
  locale,
  d,
}: {
  evidence: PriceEvidence
  formAction?: string
  locale: string
  d: Dictionary['priceEvidence']
}) {
  const money = (ore: number) => `${formatSignedOre(ore)} ${evidence.currency}`
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  return (
    <section className="card intake-form" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.intro}</p>
      {formAction && (
        <form action={formAction} className="row wrap">
          <label htmlFor="evidence-category">{d.category}</label>
          <input
            id="evidence-category"
            name="category"
            maxLength={120}
            defaultValue={evidence.category ?? ''}
          />
          <label htmlFor="evidence-query">{d.query}</label>
          <input
            id="evidence-query"
            name="q"
            maxLength={120}
            defaultValue={evidence.query ?? ''}
          />
          <button className="btn btn-secondary">{d.search}</button>
        </form>
      )}
      <p>
        {d.summary
          .replace('{count}', String(evidence.summary.count))
          .replace('{days}', String(evidence.days))}
        {evidence.summary.medianSoldOre !== null
          ? ` · ${d.median} ${money(evidence.summary.medianSoldOre)} · ${d.range} ${money(evidence.summary.minSoldOre ?? 0)} – ${money(evidence.summary.maxSoldOre ?? 0)} · ${d.averageDays.replace('{days}', String(evidence.summary.averageDaysToSale ?? 0))}`
          : ''}
      </p>
      {evidence.matches.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{d.item}</th>
                <th>{d.accepted}</th>
                <th>{d.sold}</th>
                <th>{d.daysToSale}</th>
                <th>{d.markdowns}</th>
              </tr>
            </thead>
            <tbody>
              {evidence.matches.map((m) => (
                <tr key={m.itemId}>
                  <td>
                    <Link
                      className="text-link"
                      href={`/intake/items/${m.itemId}`}
                    >
                      {m.title ?? m.itemId.slice(0, 8).toUpperCase()}
                    </Link>
                    {m.category ? ` · ${m.category}` : ''}
                  </td>
                  <td>
                    {m.acceptedPriceOre === null
                      ? '–'
                      : money(m.acceptedPriceOre)}
                  </td>
                  <td>
                    {money(m.soldPriceOre)} · {when(m.soldAt)}
                  </td>
                  <td>{m.daysToSale}</td>
                  <td>{m.markdowns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        <small>{d.notice}</small>
      </p>
    </section>
  )
}
