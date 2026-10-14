import { InventoryEditableRow } from '@/components/intake/inventory-editable-row'
import {
  InventorySelection,
  InventorySelectAll,
} from '@/components/intake/inventory-selection'
import '@/components/intake/inventory-edit.css'
import { WorkingForm } from '@/components/platform/working-form'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Handshake,
  Store,
  TrendingDown,
} from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { itemStage, originKind, formatOre } from '@/lib/engine/items'
import {
  filterKeys,
  itemFilters,
  itemSort,
  readItemDirectory,
  type ItemSort,
} from '@/lib/engine/item-directory'
import { ItemPhotoPreview } from '@/components/intake/item-photo-preview'
import { ItemIndicator } from '@/components/intake/item-indicator'
import { itemSyncStatus, syncProvider } from '@/lib/engine/item-sync'
import { readAssortmentGroups } from '@/lib/engine/item-classification'
import { readAttributeVocabulary, labelOf } from '@/lib/engine/attributes'

export default async function Items({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.items,
    t = d.directory,
    params = await searchParams
  const [groups, vocabulary] = await Promise.all([
    readAssortmentGroups(ctx.client, active.id),
    readAttributeVocabulary(ctx.client, active.id),
  ])
  const raw: Record<string, string> = {}
  for (const key of filterKeys) {
    const value = params[key]
    if (typeof value === 'string' && value.trim()) raw[key] = value.trim()
  }
  if (raw.paypal) {
    raw.syncProvider ??= 'paypal'
    raw.syncStatus ??= raw.paypal
    delete raw.paypal
  }
  for (const key of ['minPrice', 'maxPrice'])
    if (raw[key]) raw[key] = raw[key].replace(',', '.')
  const parsed = itemFilters.safeParse(raw)
  const sort = itemSort.safeParse(params.sort).success
    ? (params.sort as ItemSort)
    : 'accepted'
  const direction = params.direction === 'asc' ? 'asc' : 'desc'
  const requestedPage =
    typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1
  const href = (page: number, nextSort = sort, nextDirection = direction) => {
    const search = new URLSearchParams(raw)
    search.set('sort', nextSort)
    search.set('direction', nextDirection)
    if (page > 1) search.set('page', String(page))
    return '/intake/items?' + search.toString()
  }
  const result = parsed.success
    ? await readItemDirectory(
        ctx.client,
        active.id,
        parsed.data,
        sort,
        direction,
        requestedPage,
      )
    : null
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 25))
  if (result && requestedPage > pages) redirect(href(pages))
  const advancedCount = Object.keys(raw).filter(
    (k) => k !== 'q' && k !== 'stage',
  ).length
  const stageLabel = (s: keyof typeof all.lifecycle.stages) =>
    s === 'markdown_due' ? d.markdownWaiting : all.lifecycle.stages[s]
  const date = (value: string) =>
    new Intl.DateTimeFormat(intlLocale(ctx.locale), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Europe/Stockholm',
    }).format(new Date(value))
  const header = (key: ItemSort, label: string, numeric = false) => {
    const selected = sort === key
    const next = selected && direction === 'asc' ? 'desc' : 'asc'
    return (
      <th
        scope="col"
        className={numeric ? 'inventory-number' : undefined}
        aria-sort={
          selected ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
        }
      >
        <Link
          href={href(1, key, next)}
          aria-label={`${label}: ${next === 'asc' ? t.sortAsc : t.sortDesc}`}
        >
          {label}
          {selected ? (
            direction === 'asc' ? (
              <ArrowUp size={13} aria-hidden="true" />
            ) : (
              <ArrowDown size={13} aria-hidden="true" />
            )
          ) : (
            <ArrowUpDown size={13} aria-hidden="true" />
          )}
        </Link>
      </th>
    )
  }
  const input = (key: string, label: string, type = 'text') => (
    <div className="field">
      <label htmlFor={'items-' + key}>{label}</label>
      <input
        id={'items-' + key}
        name={key}
        type={type}
        defaultValue={raw[key] ?? ''}
        maxLength={type === 'text' ? 120 : undefined}
        inputMode={key.includes('Price') ? 'decimal' : undefined}
      />
    </div>
  )
  const select = (key: string, label: string, options: [string, string][]) => (
    <div className="field">
      <label htmlFor={'items-' + key}>{label}</label>
      <select id={'items-' + key} name={key} defaultValue={raw[key] ?? ''}>
        <option value="">{t.any}</option>
        {options.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </div>
  )
  return (
    <div className="items-directory inventory-directory">
      <div className="page-heading workspace-heading">
        <h1>{d.title}</h1>
        {active.role !== 'readonly' && (
          <div className="workspace-actions">
            <Link className="btn btn-secondary" href="/intake/quick">
              {all.quickIntake.title}
            </Link>
            <Link
              className="btn btn-secondary"
              href="/intake/purchases#purchases-new"
            >
              {all.purchases.newPurchase}
            </Link>
          </div>
        )}
      </div>
      <section className="inventory-panel" aria-label={d.list}>
        <WorkingForm
          key={JSON.stringify(raw) + sort + direction}
          action="/intake/items"
          className="inventory-filters"
          role="search"
        >
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="direction" value={direction} />
          <div className="inventory-basic">
            <div className="field">
              <label htmlFor="items-q">{d.search}</label>
              <input
                id="items-q"
                name="q"
                defaultValue={raw.q ?? ''}
                maxLength={120}
                placeholder={d.searchHint}
              />
            </div>
            <div className="field">
              <label htmlFor="items-stage">{d.stage}</label>
              <select
                id="items-stage"
                name="stage"
                defaultValue={raw.stage ?? ''}
              >
                <option value="">{d.allStages}</option>
                {itemStage.options.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary">{d.searchButton}</button>
            {!!Object.keys(raw).length && (
              <Link className="text-link" href="/intake/items">
                {d.clearFilters}
              </Link>
            )}
          </div>
          <details className="inventory-advanced" open={advancedCount > 0}>
            <summary>
              {t.advanced}
              {advancedCount > 0 && (
                <span className="inventory-filter-count">{advancedCount}</span>
              )}
            </summary>
            <div className="inventory-advanced-grid">
              {select('ownership', d.ownership, [
                ['consignment', d.ownershipKinds.consignment],
                ['store', d.ownershipKinds.store],
              ])}
              {select(
                'syncProvider',
                all.itemSync.system,
                syncProvider.options.map((provider) => [
                  provider,
                  all.itemSync.providers[provider],
                ]),
              )}
              {select(
                'syncStatus',
                all.itemSync.title,
                itemSyncStatus.options.map((s) => [s, all.itemSync.states[s]]),
              )}
              {input('seller', all.quickIntake.seller)}
              {input('category', all.quickIntake.category)}
              {select(
                'itemType',
                all.quickIntake.itemType,
                vocabulary.types
                  .filter((t) => t.active)
                  .map((t) => [t.slug, labelOf(t, ctx.locale)]),
              )}
              {select(
                'assortment',
                all.itemWorkflow.group,
                groups.map((g) => [g.id, g.name]),
              )}
              {select('photo', t.photo, [
                ['yes', t.withPhoto],
                ['no', t.withoutPhoto],
              ])}
              {input('minPrice', t.minPrice)}
              {input('maxPrice', t.maxPrice)}
              {input('acceptedFrom', t.acceptedFrom, 'date')}
              {input('acceptedTo', t.acceptedTo, 'date')}
              {input('endsBefore', t.endsBefore, 'date')}
              {select(
                'origin',
                t.origin,
                originKind.options.map((o) => [o, d.originKinds[o]]),
              )}
            </div>
            <button className="btn btn-secondary">{d.searchButton}</button>
          </details>
        </WorkingForm>
        {!parsed.success && (
          <p role="alert" className="inventory-message">
            {t.invalid}
          </p>
        )}
        {parsed.success && !result && (
          <p role="status" className="inventory-message">
            {all.stock.notAvailable}
          </p>
        )}
        {result && (
          <InventorySelection
            key={
              active.id + JSON.stringify(raw) + requestedPage + sort + direction
            }
            ids={result.items
              .filter((i) =>
                ['on_sale', 'markdown_due', 'period_ending'].includes(i.stage),
              )
              .map((i) => i.id)}
          >
            <WorkingForm
              id="label-selection"
              action="/intake/items/labels"
              className="row wrap"
            >
              <button className="btn btn-secondary">
                {all.labelSheets.title}
              </button>
              {['owner', 'admin', 'staff'].includes(active.role) && (
                <button
                  className="btn btn-secondary"
                  formAction="/intake/items/classify"
                >
                  {all.itemWorkflow.bulk}
                </button>
              )}
              <small>{all.labelSheets.selection}</small>
            </WorkingForm>
            <div
              className="inventory-table-scroll"
              role="region"
              aria-label={d.list}
              tabIndex={0}
            >
              <table className="inventory-table">
                <caption className="sr-only">{d.list}</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <InventorySelectAll label={all.itemWorkflow.selectAll} />
                    </th>
                    {header('title', d.item)}
                    <th scope="col">
                      <span className="sr-only">{t.details}</span>
                    </th>
                    {header('category', all.quickIntake.category)}
                    <th scope="col">{all.quickIntake.itemType}</th>
                    <th scope="col">{all.itemWorkflow.group}</th>
                    <th scope="col">
                      <span className="sr-only">
                        {all.itemWorkflow.editRow}
                      </span>
                    </th>
                    {header('seller', all.quickIntake.seller)}
                    {header('price', all.quickIntake.price, true)}
                    {header('stage', d.stage)}
                    <th scope="col">{all.itemSync.title}</th>
                    {header('accepted', t.registered)}
                    {header('periodEnd', t.periodEnd)}
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((i) => (
                    <InventoryEditableRow
                      key={i.id}
                      item={i}
                      tenantId={active.id}
                      write={['owner', 'admin', 'staff'].includes(active.role)}
                      types={vocabulary.types
                        .filter((type) => type.active)
                        .map((type) => ({
                          id: type.slug,
                          name: labelOf(type, ctx.locale),
                        }))}
                      groups={groups}
                      d={all}
                      indicators={
                        <div className="inventory-indicators">
                          <ItemIndicator label={d.ownershipKinds[i.ownership]}>
                            {i.ownership === 'store' ? (
                              <Store size={16} aria-hidden="true" />
                            ) : (
                              <Handshake size={16} aria-hidden="true" />
                            )}
                          </ItemIndicator>
                          {i.defaultPhotoId && (
                            <ItemPhotoPreview
                              tenantId={active.id}
                              itemId={i.id}
                              photoId={i.defaultPhotoId}
                              count={i.photoCount}
                              title={i.title || d.item}
                              d={all.itemPhotos}
                            />
                          )}
                        </div>
                      }
                    >
                      <td>
                        {i.sellerId ? (
                          <Link
                            className="inventory-seller"
                            href={`/intake/sellers/${i.sellerId}`}
                            title={i.sellerName || undefined}
                          >
                            {i.sellerName || '—'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="inventory-number inventory-price">
                        {i.currentPriceOre === null
                          ? '—'
                          : `${formatOre(i.currentPriceOre)} ${result.currency}`}
                      </td>
                      <td className="inventory-state" data-stage={i.stage}>
                        {i.stage === 'markdown_due' ? (
                          <ItemIndicator
                            warning
                            label={
                              i.nextMarkdownAt
                                ? t.markdownOn
                                    .replace('{date}', date(i.nextMarkdownAt))
                                    .replace(
                                      '{percent}',
                                      String(i.nextMarkdownPercent ?? ''),
                                    )
                                : d.markdownWaiting
                            }
                          >
                            <TrendingDown size={17} aria-hidden="true" />
                          </ItemIndicator>
                        ) : (
                          stageLabel(i.stage)
                        )}
                      </td>
                      <td>
                        {i.sync?.length
                          ? i.sync.map((connection) => (
                              <Link
                                key={connection.connectionId}
                                className="item-sync-state inventory-sync-link"
                                data-state={connection.status}
                                href={`/intake/items/${i.id}#sync-status`}
                              >
                                {all.itemSync.providers[connection.provider]} ·{' '}
                                {all.itemSync.states[connection.status]}
                              </Link>
                            ))
                          : '—'}
                      </td>
                      <td className="inventory-date">
                        <time dateTime={i.acceptedAt}>
                          {date(i.acceptedAt)}
                        </time>
                      </td>
                      <td className="inventory-date">
                        <time dateTime={i.periodEnd}>{date(i.periodEnd)}</time>
                      </td>
                    </InventoryEditableRow>
                  ))}
                </tbody>
              </table>
            </div>
            {!result.items.length && (
              <p className="inventory-message">
                {Object.keys(raw).length ? d.noMatches : d.empty}
              </p>
            )}
            <footer className="inventory-footer">
              <span>
                {d.showingRange
                  .replace(
                    '{from}',
                    String(result.total ? result.offset + 1 : 0),
                  )
                  .replace('{to}', String(result.offset + result.items.length))
                  .replace('{total}', String(result.total))}
              </span>
              {pages > 1 && (
                <nav className="inventory-pagination" aria-label={d.pagination}>
                  {requestedPage > 1 ? (
                    <Link
                      className="btn btn-secondary"
                      href={href(requestedPage - 1)}
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
                      .replace('{page}', String(requestedPage))
                      .replace('{pages}', String(pages))}
                  </span>
                  {requestedPage < pages ? (
                    <Link
                      className="btn btn-secondary"
                      href={href(requestedPage + 1)}
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
          </InventorySelection>
        )}
      </section>
    </div>
  )
}
export const generateMetadata = () => platformPageMetadata((d) => d.items.title)
