import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { notFound } from 'next/navigation'
import { WorkingForm } from '@/components/platform/working-form'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { EventTime } from '@/components/ui/event-time'
import type { Dictionary } from '@/lib/i18n'
import { itemStage, formatOre } from '@/lib/engine/items'
import {
  searchSellerWorkspaceItems,
  sellerItemSearch,
  type SellerItemSearch,
} from '@/lib/engine/seller-workspace'

export async function SellerItemsTable({
  client,
  tenant,
  seller,
  query,
  all,
  locale,
  currency,
}: {
  client: SupabaseClient
  tenant: string
  seller: string
  query: Record<string, string | string[] | undefined>
  all: Dictionary
  locale: string
  currency: string
}) {
  const parsed = sellerItemSearch.safeParse({
    page: typeof query.itemsPage === 'string' ? Number(query.itemsPage) : 0,
    query: query.itemsQ ?? '',
    stage: query.itemsStage ?? '',
    sort: query.itemsSort ?? 'accepted',
    direction: query.itemsDirection ?? 'desc',
  })
  if (!parsed.success) notFound()
  const options = parsed.data
  const result = await searchSellerWorkspaceItems(
    client,
    tenant,
    seller,
    options,
  )
  const d = all.items,
    t = d.directory
  const path = '/intake/sellers/' + seller
  const preserved = Object.entries(query).filter(
    ([key, value]) =>
      ['ledgerPage', 'feePage', 'messagesPage', 'older', 'newer'].includes(
        key,
      ) && typeof value === 'string',
  ) as [string, string][]
  function href(
    page: number,
    sort = options.sort,
    direction = options.direction,
    clear = false,
  ) {
    const params = new URLSearchParams(preserved)
    params.set('itemsSort', sort)
    params.set('itemsDirection', direction)
    if (page) params.set('itemsPage', String(page))
    if (!clear && options.query) params.set('itemsQ', options.query)
    if (!clear && options.stage) params.set('itemsStage', options.stage)
    return `${path}?${params}#seller-items`
  }
  const header = (
    sort: SellerItemSearch['sort'],
    label: string,
    numeric = false,
  ) => {
    const selected = options.sort === sort
    const next = selected && options.direction === 'asc' ? 'desc' : 'asc'
    const Icon = selected
      ? options.direction === 'asc'
        ? ArrowUp
        : ArrowDown
      : ArrowUpDown
    return (
      <th
        scope="col"
        className={numeric ? 'inventory-number' : undefined}
        aria-sort={
          selected
            ? options.direction === 'asc'
              ? 'ascending'
              : 'descending'
            : 'none'
        }
      >
        <Link
          href={href(0, sort, next)}
          aria-label={`${label}: ${next === 'asc' ? t.sortAsc : t.sortDesc}`}
        >
          {label}
          <Icon size={13} aria-hidden="true" />
        </Link>
      </th>
    )
  }
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 25))
  return (
    <section className="inventory-panel" aria-label={all.sellerWorkspace.items}>
      <WorkingForm
        action={`${path}#seller-items`}
        className="inventory-filters"
      >
        {preserved.map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <input type="hidden" name="itemsSort" value={options.sort} />
        <input type="hidden" name="itemsDirection" value={options.direction} />
        <div className="inventory-basic">
          <div className="field">
            <label htmlFor="seller-item-search">{d.search}</label>
            <input
              id="seller-item-search"
              type="search"
              name="itemsQ"
              maxLength={120}
              defaultValue={options.query}
              placeholder={d.searchHint}
            />
          </div>
          <div className="field">
            <label htmlFor="seller-item-stage">{d.stage}</label>
            <select
              id="seller-item-stage"
              name="itemsStage"
              defaultValue={options.stage}
            >
              <option value="">{d.allStages}</option>
              {itemStage.options.map((stage) => (
                <option key={stage} value={stage}>
                  {all.lifecycle.stages[stage]}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            {d.searchButton}
          </button>
          {(options.query || options.stage) && (
            <Link
              className="text-link"
              href={href(0, options.sort, options.direction, true)}
            >
              {d.clearFilters}
            </Link>
          )}
        </div>
      </WorkingForm>
      {!result ? (
        <p className="inventory-message" role="alert">
          {all.intake.failed}
        </p>
      ) : (
        <>
          <div
            className="inventory-table-scroll seller-item-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={d.list}
          >
            <table className="inventory-table">
              <thead>
                <tr>
                  {header('title', d.item)}
                  {header('price', all.quickIntake.price, true)}
                  {header('stage', d.stage)}
                  {header('category', all.quickIntake.category)}
                  {header('accepted', t.registered)}
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => {
                  const price =
                    item.stage === 'sold' ? item.soldPriceOre : item.priceOre
                  return (
                    <tr key={item.id} className="inventory-row">
                      <th scope="row">
                        <Link
                          className="inventory-item-link"
                          href={'/intake/items/' + item.id}
                          title={`${item.title || d.item} · I-${item.id.slice(0, 8).toUpperCase()}`}
                        >
                          {item.title || d.item}
                        </Link>
                      </th>
                      <td className="inventory-number inventory-price">
                        {price === null
                          ? '—'
                          : `${formatOre(price)} ${currency}`}
                      </td>
                      <td>
                        <span
                          className="inventory-cell-text"
                          title={all.lifecycle.stages[item.stage]}
                        >
                          {all.lifecycle.stages[item.stage]}
                        </span>
                      </td>
                      <td>
                        <span
                          className="inventory-cell-text"
                          title={item.category || undefined}
                        >
                          {item.category || '—'}
                        </span>
                      </td>
                      <td className="inventory-date">
                        <EventTime value={item.acceptedAt} locale={locale} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!result.items.length && (
            <p className="inventory-message">
              {options.query || options.stage
                ? d.noMatches
                : all.sellerWorkspace.noItems}
            </p>
          )}
          <footer className="inventory-footer">
            <span>
              {d.showingRange
                .replace(
                  '{from}',
                  String(result.total ? result.page * 25 + 1 : 0),
                )
                .replace('{to}', String(result.page * 25 + result.items.length))
                .replace('{total}', String(result.total))}
            </span>
            {pages > 1 && (
              <nav className="inventory-pagination" aria-label={d.pagination}>
                {result.page > 0 ? (
                  <Link
                    className="btn btn-secondary"
                    href={href(result.page - 1)}
                  >
                    {d.previousPage}
                  </Link>
                ) : (
                  <span className="btn btn-secondary" aria-disabled="true">
                    {d.previousPage}
                  </span>
                )}
                <span>
                  {d.pageOf
                    .replace('{page}', String(result.page + 1))
                    .replace('{pages}', String(pages))}
                </span>
                {result.page + 1 < pages ? (
                  <Link
                    className="btn btn-secondary"
                    href={href(result.page + 1)}
                  >
                    {d.nextPage}
                  </Link>
                ) : (
                  <span className="btn btn-secondary" aria-disabled="true">
                    {d.nextPage}
                  </span>
                )}
              </nav>
            )}
          </footer>
        </>
      )}
    </section>
  )
}
