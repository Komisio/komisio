import { WorkingForm } from '@/components/platform/working-form'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from '@/components/platform/working-link'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { sellerSortKeys, readSellersOverviewPage } from '@/lib/engine/sellers'
import { economyFormat } from '@/lib/intake/economy-format'
import { directoryOrder } from '@/lib/intake/directory-order'
import {
  CompactDirectory,
  DirectoryOrder,
  type DirectoryColumn,
} from '@/components/ui/compact-directory'

/** The store's sellers: search, what the store holds for each, balance, and the way to each seller's page. */
export default async function Sellers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const type =
    params.type === 'private' || params.type === 'business'
      ? params.type
      : 'all'
  const order = directoryOrder(sellerSortKeys, params.order)
  const pageSize = 25
  const requestedPage =
    typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1
  const pageHref = (page: number, nextOrder = order.value, query = q) => {
    const search = new URLSearchParams()
    if (type !== 'all') search.set('type', type)
    if (query) search.set('q', query)
    if (nextOrder !== 'name:asc') search.set('order', nextOrder)
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
      order.sort,
      order.direction,
      type,
    ),
  ])
  const pages = paged ? Math.max(1, Math.ceil(paged.total / pageSize)) : 1
  if (paged && requestedPage > pages) redirect(pageHref(pages))
  const overview = paged
  const format = economyFormat(ctx.locale)
  const money = (ore: number) => format.money(ore, currency)
  const columns: DirectoryColumn[] = sellerSortKeys.map((key) => ({
    key,
    label: key === 'name' ? d.name : d[key],
    numeric: key !== 'name',
    width: key === 'name' ? 30 : key === 'items' || key === 'sold' ? 10 : 25,
    href: pageHref(
      1,
      `${key}:${order.sort === key && order.direction === 'asc' ? 'desc' : 'asc'}`,
    ),
    order:
      order.sort === key
        ? order.direction === 'asc'
          ? 'ascending'
          : 'descending'
        : undefined,
  }))
  return (
    <div className="seller-directory-page">
      <div className="page-heading seller-directory-heading">
        <h1>{d.title}</h1>
        {active.role !== 'readonly' && (
          <Link
            className="btn btn-secondary"
            href="/intake/sellers/registrations"
          >
            {all.selfRegistration.queue}
          </Link>
        )}
        {['owner', 'admin'].includes(active.role) && (
          <Link className="btn btn-secondary" href="/intake/sellers/email">
            {all.storeMail.title}
          </Link>
        )}
        {active.role !== 'readonly' && (
          <Link className="btn btn-primary" href="/intake/sellers/new">
            {d.register}
          </Link>
        )}
      </div>
      <section className="card seller-directory" aria-label={d.title}>
        <WorkingForm
          action="/intake/sellers"
          className="seller-directory-search directory-filters"
        >
          <div className="field directory-search-field">
            <label htmlFor="sellers-q">{d.search}</label>
            <input
              id="sellers-q"
              name="q"
              type="search"
              placeholder={d.searchHint}
              defaultValue={q}
              maxLength={120}
            />
          </div>
          <div className="field">
            <label htmlFor="sellers-type">
              {all.sellerDetails.business.type}
            </label>
            <select id="sellers-type" name="type" defaultValue={type}>
              <option value="all">{all.sellerDetails.business.all}</option>
              <option value="private">
                {all.sellerDetails.business.private}
              </option>
              <option value="business">
                {all.sellerDetails.business.business}
              </option>
            </select>
          </div>
          <DirectoryOrder
            columns={columns}
            value={order.value}
            id="sellers-order"
            label={all.directory.sortBy}
            ascending={all.items.directory.sortAsc}
            descending={all.items.directory.sortDesc}
          />
          <button className="btn btn-secondary">{d.searchButton}</button>
          {q && (
            <Link className="text-link" href={pageHref(1, order.value, '')}>
              {d.clear}
            </Link>
          )}
        </WorkingForm>
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
          <CompactDirectory
            label={d.title}
            columns={columns}
            rows={overview.sellers.map((s) => ({
              id: s.id,
              cells: [
                <div key="identity" className="directory-identity">
                  <Link
                    className="directory-primary-link"
                    href={`/intake/sellers/${s.id}`}
                  >
                    {s.name}
                  </Link>
                  {s.sellerType === 'business' && (
                    <small className="badge">
                      {all.sellerDetails.business.business}
                    </small>
                  )}
                  <div className="directory-contact">
                    {s.email && (
                      <a href={`mailto:${s.email}`} title={s.email}>
                        {s.email}
                      </a>
                    )}
                    {s.phone && (
                      <a
                        href={`tel:${s.phone.replace(/[^+0-9]/g, '')}`}
                        title={s.phone}
                      >
                        {s.phone}
                      </a>
                    )}
                    {!s.email && !s.phone && s.contact && (
                      <span>{s.contact}</span>
                    )}
                    {s.city && <span title={s.city}>{s.city}</span>}
                  </div>
                </div>,
                format.number(s.itemsTotal),
                format.number(s.itemsSold),
                money(s.availableOre),
                money(s.reservedOre),
              ],
            }))}
          />
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

export const generateMetadata = () =>
  platformPageMetadata((d) => d.sellersList.title)
