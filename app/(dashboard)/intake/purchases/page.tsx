import { readAttributeVocabulary } from '@/lib/engine/attributes'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { NavigationLink } from '@/components/platform/navigation-warning'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { PurchaseForm } from '@/components/intake/purchase-form'
import { AcceptItemForm } from '@/components/intake/accept-item-form'
import { PurchaseFilters } from '@/components/intake/purchase-filters'
import {
  readPurchasePage,
  purchaseSort,
  purchaseStatus,
  type PurchaseSort,
} from '@/lib/engine/purchases'

function formatOre(value: number | string) {
  const ore = BigInt(value)
  return `${ore / 100n}.${(ore % 100n).toString().padStart(2, '0')}`
}

export default async function Purchases({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.purchases
  const params = await searchParams
  const query =
    typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const status = purchaseStatus.safeParse(params.status).data ?? 'all'
  const sort = purchaseSort.safeParse(params.sort).data ?? 'date'
  const direction = params.direction === 'asc' ? 'asc' : 'desc'
  const pageSize = 20
  const requestedPage =
    typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1
  const href = (
    page: number,
    order: PurchaseSort = sort,
    dir: string = direction,
  ) => {
    const search = new URLSearchParams()
    if (query) search.set('q', query)
    if (status !== 'all') search.set('status', status)
    if (order !== 'date') search.set('sort', order)
    if (dir !== 'desc') search.set('direction', dir)
    if (page > 1) search.set('page', String(page))
    return `/intake/purchases${search.size ? '?' + search : ''}#purchases-history`
  }
  const [currency, result] = await Promise.all([
    readStoreCurrency(ctx.client, active.id),
    readPurchasePage(ctx.client, active.id, {
      query,
      status,
      sort,
      direction,
      offset: (requestedPage - 1) * pageSize,
      limit: pageSize,
    }),
  ])
  const pages = Math.max(1, Math.ceil(result.total / pageSize))
  if (requestedPage > pages) redirect(href(pages))
  const common = all.sellersList
  const vocabulary = await readAttributeVocabulary(ctx.client, active.id)
  const sortHeading = (key: PurchaseSort, label: string, numeric = false) => (
    <th
      scope="col"
      className={numeric ? 'purchase-numeric' : undefined}
      aria-sort={
        sort === key
          ? direction === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <NavigationLink
        warningScope="item-acceptance"
        href={href(
          1,
          key,
          sort === key && direction === 'asc' ? 'desc' : 'asc',
        )}
      >
        {label}
        <span aria-hidden="true">
          {sort === key ? (direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
        </span>
      </NavigationLink>
    </th>
  )
  return (
    <>
      <div className="page-heading workspace-heading">
        <FormHelpHeading
          title={d.title}
          level={1}
          help={{
            label: d.helpLabel,
            steps: [d.intro, d.notice.replace('{accept}', d.prepareItem)],
          }}
        />
      </div>
      <WorkspaceTabs
        id="purchases"
        label={d.title}
        tabs={[
          {
            id: 'history',
            label: d.history,
            content: (
              <section
                className="card purchase-directory"
                id="purchase-list"
                aria-label={d.history}
              >
                <PurchaseFilters
                  key={`${query}|${status}|${sort}|${direction}`}
                  query={query}
                  status={status}
                  sort={sort}
                  direction={direction}
                  d={d}
                />
                <p className="purchase-count" role="status">
                  {d.showing
                    .replace(
                      '{from}',
                      String(
                        result.total ? (requestedPage - 1) * pageSize + 1 : 0,
                      ),
                    )
                    .replace(
                      '{to}',
                      String(Math.min(requestedPage * pageSize, result.total)),
                    )
                    .replace('{total}', String(result.total))}
                </p>
                <div
                  className="purchase-table-scroll"
                  role="region"
                  aria-label={d.history}
                  tabIndex={0}
                >
                  <table className="purchase-table">
                    <caption className="sr-only">{d.history}</caption>
                    <thead>
                      <tr>
                        {sortHeading('reference', d.reference)}
                        {sortHeading('note', d.description)}
                        {sortHeading('date', d.purchasedAt)}
                        {sortHeading('cost', `${d.price} (${currency})`, true)}
                        {sortHeading('status', d.status)}
                        {sortHeading(
                          'price',
                          `${all.items.purchaseSalePrice} (${currency})`,
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((p) => (
                        <tr
                          key={p.id}
                          id={`purchase-${p.id}`}
                          className="purchase-entry"
                        >
                          <td>
                            <NavigationLink
                              className="text-link purchase-reference"
                              href={`/intake/purchases/${p.id}`}
                            >
                              P-{p.reference}
                            </NavigationLink>
                          </td>
                          <td
                            className="purchase-description"
                            title={p.supplier_note}
                          >
                            {p.supplier_note || '—'}
                          </td>
                          <td className="purchase-date">
                            <time dateTime={p.purchased_at}>
                              {new Date(p.purchased_at).toLocaleDateString(
                                intlLocale(ctx.locale),
                                {
                                  timeZone: 'Europe/Stockholm',
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                },
                              )}
                            </time>
                          </td>
                          <td className="purchase-numeric">
                            {formatOre(p.purchase_price_ore)}
                          </td>
                          <td>
                            <span
                              className={`purchase-status ${p.item_id ? 'is-registered' : 'is-pending'}`}
                            >
                              {p.item_id ? d.statusRegistered : d.statusPending}
                            </span>
                          </td>
                          <td className="purchase-sale-cell">
                            {p.item_id ? (
                              <div className="purchase-item-link">
                                <span>
                                  {p.sale_price_ore === null
                                    ? '—'
                                    : formatOre(p.sale_price_ore)}
                                </span>
                                <NavigationLink
                                  className="text-link"
                                  href={`/intake/items/${p.item_id}`}
                                >
                                  {all.items.open}
                                </NavigationLink>
                              </div>
                            ) : active.role !== 'readonly' ? (
                              <AcceptItemForm
                                currency={currency}
                                locale={ctx.locale}
                                compact
                                tenantId={active.id}
                                originKind="purchase"
                                originId={p.id}
                                originRevision={null}
                                d={all.items}
                                intake={all.intake}
                                leaveUnsaved={all.leaveUnsaved}
                              />
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!result.rows.length && (
                  <p className="purchase-empty">
                    {query || status !== 'all' ? d.noMatches : d.empty}
                  </p>
                )}
                {pages > 1 && (
                  <nav
                    className="seller-directory-pagination"
                    aria-label={d.history}
                  >
                    {requestedPage > 1 && (
                      <NavigationLink
                        warningScope="item-acceptance"
                        className="btn btn-secondary"
                        href={href(requestedPage - 1)}
                      >
                        {common.previousPage}
                      </NavigationLink>
                    )}
                    <span>
                      {common.pageOf
                        .replace('{page}', String(requestedPage))
                        .replace('{pages}', String(pages))}
                    </span>
                    {requestedPage < pages && (
                      <NavigationLink
                        warningScope="item-acceptance"
                        className="btn btn-secondary"
                        href={href(requestedPage + 1)}
                      >
                        {common.nextPage}
                      </NavigationLink>
                    )}
                  </nav>
                )}
              </section>
            ),
          },
          ...(active.role !== 'readonly'
            ? [
                {
                  id: 'new',
                  label: d.newPurchase,
                  content: (
                    <div className="page-reading-width">
                      <PurchaseForm
                        key={active.id}
                        tenantId={active.id}
                        d={d}
                        intake={all.intake}
                        vocabulary={vocabulary}
                        locale={ctx.locale}
                        itemTypeLabel={all.quickIntake.itemType}
                        registration={all.registration}
                        descriptionRequired={
                          vocabulary.registration?.settings.descriptionRequired
                        }
                        leaveUnsaved={all.leaveUnsaved}
                      />
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.purchases.title)
