import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readSellersOverview } from '@/lib/engine/sellers'
import { formatSignedOre } from '@/lib/engine/seller-ledger'

/** The store's sellers: search, what the store holds for each, balance, and the way to each seller's page. */
export default async function Sellers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.sellersList
  const [currency, overview] = await Promise.all([
    readStoreCurrency(ctx.client, active.id),
    readSellersOverview(ctx.client, active.id, q),
  ])
  const money = (ore: number) => `${formatSignedOre(ore)} ${currency}`
  return (
    <>
      <div className="page-heading seller-directory-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="btn btn-primary" href="/intake">
          {d.register}
        </Link>
      </div>
      <section className="card seller-directory" aria-label={d.title}>
        <form action="/intake/sellers" className="seller-directory-search">
          <label htmlFor="sellers-q">{d.search}</label>
          <div className="row">
            <input
              id="sellers-q"
              name="q"
              type="search"
              placeholder={d.searchHint}
              defaultValue={q}
              maxLength={120}
            />
            <button className="btn btn-secondary">{d.searchButton}</button>
            {q && (
              <Link className="text-link" href="/intake/sellers">
                {d.clear}
              </Link>
            )}
          </div>
        </form>
        {overview && (
          <p>
            <small>
              {overview.total <= overview.limit
                ? d.showingAll.replace('{total}', String(overview.total))
                : d.showingSome
                    .replace('{limit}', String(overview.limit))
                    .replace('{total}', String(overview.total))}
            </small>
          </p>
        )}
        {overview && overview.sellers.length === 0 && <p>{d.empty}</p>}
        {overview && overview.sellers.length > 0 && (
          <div className="seller-directory-results">
            <table className="seller-directory-table">
              <thead>
                <tr>
                  <th>{d.name}</th>
                  <th>{d.contact}</th>
                  <th>{d.items}</th>
                  <th>{d.sold}</th>
                  <th>{d.available}</th>
                  <th>{d.reserved}</th>
                </tr>
              </thead>
              <tbody>
                {overview.sellers.map((s) => (
                  <tr key={s.id}>
                    <td data-label={d.name}>
                      <Link
                        className="text-link"
                        href={`/intake/sellers/${s.id}`}
                      >
                        {s.name}
                      </Link>
                      {s.city && (
                        <small className="seller-directory-city">
                          {s.city}
                        </small>
                      )}
                    </td>
                    <td
                      data-label={d.contact}
                      className="seller-directory-contact"
                    >
                      {s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}
                      {s.phone && (
                        <a href={`tel:${s.phone.replace(/[^+0-9]/g, '')}`}>
                          {s.phone}
                        </a>
                      )}
                      {!s.email && !s.phone && (s.contact || '—')}
                    </td>
                    <td data-label={d.items}>{s.itemsTotal}</td>
                    <td data-label={d.sold}>{s.itemsSold}</td>
                    <td
                      data-label={d.available}
                      className="seller-directory-balance"
                    >
                      {money(s.availableOre)}
                    </td>
                    <td data-label={d.reserved}>{money(s.reservedOre)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
