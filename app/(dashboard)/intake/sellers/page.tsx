import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  readSellersOverview,
  readSellersOverviewPage,
} from '@/lib/engine/sellers'
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
  const pageSize = 25
  const requestedPage =
    typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1
  const pageHref = (page: number) => {
    const search = new URLSearchParams()
    if (q) search.set('q', q)
    if (page > 1) search.set('page', String(page))
    return '/intake/sellers' + (search.size ? '?' + search.toString() : '')
  }
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.sellersList
  const [currency, paged] = await Promise.all([
    readStoreCurrency(ctx.client, active.id),
    readSellersOverviewPage(
      ctx.client,
      active.id,
      q,
      (requestedPage - 1) * pageSize,
      pageSize,
    ),
  ])
  const pages = paged ? Math.max(1, Math.ceil(paged.total / pageSize)) : 1
  if (paged && requestedPage > pages) redirect(pageHref(pages))
  const overview =
    paged ?? (await readSellersOverview(ctx.client, active.id, q))
  const money = (ore: number) => `${formatSignedOre(ore)} ${currency}`
  return (
    <div className="seller-directory-page">
      <div className="page-heading seller-directory-heading">
        <h1>{d.title}</h1>
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
          <p className="seller-directory-count">
            <small>
              {paged && paged.total > 0
                ? d.showingRange
                    .replace('{from}', String(paged.offset + 1))
                    .replace(
                      '{to}',
                      String(paged.offset + paged.sellers.length),
                    )
                    .replace('{total}', String(paged.total))
                : overview.total <= overview.limit
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
                  <th>{all.intake.email}</th>
                  <th>{all.intake.phone}</th>
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
                      {!s.email && !s.phone && s.contact && (
                        <small className="seller-directory-city">
                          {s.contact}
                        </small>
                      )}
                      {s.city && (
                        <small className="seller-directory-city">
                          {s.city}
                        </small>
                      )}
                    </td>
                    <td
                      data-label={all.intake.email}
                      className="seller-directory-contact"
                    >
                      {s.email ? (
                        <a href={`mailto:${s.email}`} title={s.email}>
                          {s.email}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      data-label={all.intake.phone}
                      className="seller-directory-contact"
                    >
                      {s.phone ? (
                        <a
                          href={`tel:${s.phone.replace(/[^+0-9]/g, '')}`}
                          title={s.phone}
                        >
                          {s.phone}
                        </a>
                      ) : (
                        '—'
                      )}
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
        {paged && pages > 1 && (
          <nav
            className="seller-directory-pagination"
            aria-label={d.pagination}
          >
            {requestedPage > 1 && (
              <Link
                className="btn btn-secondary"
                href={pageHref(requestedPage - 1)}
              >
                {d.previousPage}
              </Link>
            )}
            <span>
              {d.pageOf
                .replace('{page}', String(requestedPage))
                .replace('{pages}', String(pages))}
            </span>
            {requestedPage < pages && (
              <Link
                className="btn btn-secondary"
                href={pageHref(requestedPage + 1)}
              >
                {d.nextPage}
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  )
}
