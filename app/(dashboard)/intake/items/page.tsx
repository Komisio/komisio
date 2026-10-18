import { X } from 'lucide-react'
import {
  itemFilterHref,
  itemWeekCutoff,
} from '@/lib/engine/item-filter-navigation'
import { InventoryTable } from '@/components/intake/inventory-table'
import {
  InventoryFilters,
  InventoryAdvanced,
} from '@/components/intake/inventory-filters'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { originKind } from '@/lib/engine/items'
import {
  filterKeys,
  itemFilters,
  itemFilterStage,
  itemSort,
  readItemDirectory,
  type ItemSort,
} from '@/lib/engine/item-directory'
import { itemSyncStatus, syncProvider } from '@/lib/engine/item-sync'
import { readAssortmentGroups } from '@/lib/engine/item-classification'
import { readAttributeVocabulary, labelOf } from '@/lib/engine/attributes'
import { readItemCategories } from '@/lib/engine/item-categories'

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
  const [groups, vocabulary, categories] = await Promise.all([
    readAssortmentGroups(ctx.client, active.id),
    readAttributeVocabulary(ctx.client, active.id),
    readItemCategories(ctx.client, active.id),
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
  const stageLabel = (s: (typeof itemFilterStage.options)[number]) =>
    s === 'active'
      ? all.sellerPortal.itemFilters.active
      : s === 'markdown_due'
        ? d.markdownWaiting
        : all.lifecycle.stages[s]
  const filterHref = (changes: Record<string, string | null>) =>
    itemFilterHref({ ...raw, sort, direction }, changes)
  const filterLabels: Record<string, string> = {
    q: d.search,
    stage: d.stage,
    ownership: d.ownership,
    seller: all.quickIntake.seller,
    category: all.quickIntake.category,
    itemType: all.quickIntake.itemType,
    assortment: all.itemWorkflow.group,
    minPrice: t.minPrice,
    maxPrice: t.maxPrice,
    acceptedFrom: t.acceptedFrom,
    acceptedTo: t.acceptedTo,
    endsBefore: t.endsBefore,
    periodWindow: t.periodWindow,
    photo: t.photo,
    origin: t.origin,
    syncProvider: all.itemSync.system,
    syncStatus: all.itemSync.title,
  }
  const filterValue = (key: string, value: string) => {
    if (key === 'stage' && itemFilterStage.safeParse(value).success)
      return stageLabel(value as (typeof itemFilterStage.options)[number])
    const labels: Record<string, Record<string, string>> = {
      ownership: d.ownershipKinds,
      origin: d.originKinds,
      syncProvider: all.itemSync.providers,
      syncStatus: all.itemSync.states,
      photo: { yes: t.withPhoto, no: t.withoutPhoto },
      periodWindow: { next7days: all.stock.nearingEnd },
    }
    if (key === 'itemType') {
      const type = vocabulary.types.find((type) => type.slug === value)
      return type ? labelOf(type, ctx.locale) : value
    }
    if (key === 'assortment')
      return groups.find((g) => g.id === value)?.name ?? value
    return labels[key]?.[value] ?? value
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
        <InventoryFilters key={active.id}>
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
                {itemFilterStage.options.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <InventoryAdvanced
            initialOpen={advancedCount > 0}
            summary={
              <>
                {t.advanced}
                {advancedCount > 0 && (
                  <span className="inventory-filter-count">
                    {advancedCount}
                  </span>
                )}
              </>
            }
          >
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
              {select('periodWindow', t.periodWindow, [
                ['next7days', all.stock.nearingEnd],
              ])}
              {select(
                'origin',
                t.origin,
                originKind.options.map((o) => [o, d.originKinds[o]]),
              )}
            </div>
          </InventoryAdvanced>
        </InventoryFilters>
        <nav className="inventory-filter-links" aria-label={t.quickFilters}>
          <span className="muted">{t.quickFilters}</span>
          <Link
            className="inventory-filter-chip"
            href={filterHref({ stage: 'markdown_due' })}
          >
            {d.markdownWaiting}
          </Link>
          <Link
            className="inventory-filter-chip"
            href={filterHref({ endsBefore: itemWeekCutoff() })}
          >
            {t.endsWithinWeek}
          </Link>
        </nav>
        {!!Object.keys(raw).length && (
          <nav className="inventory-filter-links" aria-label={t.activeFilters}>
            <span className="muted">{t.activeFilters}</span>
            {Object.entries(raw).map(([key, value]) => {
              const label = `${filterLabels[key] ?? key}: ${filterValue(key, value)}`
              return (
                <Link
                  key={key}
                  className="inventory-filter-chip inventory-filter-chip-active"
                  href={filterHref({ [key]: null })}
                  aria-label={t.removeFilter.replace('{filter}', label)}
                >
                  <span>{label}</span>
                  <X size={16} aria-hidden="true" />
                </Link>
              )
            })}
            <Link className="text-link" href="/intake/items">
              {d.clearFilters}
            </Link>
          </nav>
        )}
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
          <InventoryTable
            selectionKey={
              active.id + JSON.stringify(raw) + requestedPage + sort + direction
            }
            items={result.items}
            tenantId={active.id}
            currency={result.currency}
            locale={ctx.locale}
            groups={groups}
            types={vocabulary.types}
            categories={categories}
            write={['owner', 'admin', 'staff'].includes(active.role)}
            manage={['owner', 'admin'].includes(active.role)}
            sort={sort}
            direction={direction}
            sortHref={(key, next) => href(1, key, next)}
          >
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
          </InventoryTable>
        )}
      </section>
    </div>
  )
}
export const generateMetadata = () => platformPageMetadata((d) => d.items.title)
