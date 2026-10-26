import {
  InventoryTableShell,
  InventorySortHeader,
  InventoryFooter,
} from '@/components/intake/inventory-table-shell'
import { LifecycleTableRow } from '@/components/intake/lifecycle-table-row'
import { Handshake, Store } from 'lucide-react'
import { WorkingForm } from '@/components/platform/working-form'
import { ItemPhotoPreview } from '@/components/intake/item-photo-preview'
import { readItemPhotos } from '@/lib/engine/item-photos'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from '@/components/platform/working-link'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  readLifecycleQueue,
  readLifecycleQueuePage,
  readMarkdownRuns,
  lifecycleStage,
  lifecycleSort,
  type LifecycleSort,
} from '@/lib/engine/lifecycle'
import { readStorePolicy } from '@/lib/engine/store-policy'
import { ApplyDueMarkdowns } from '@/components/intake/apply-due-markdowns'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { LifecycleActions } from '@/components/intake/lifecycle-actions'
import { LifecycleBatch } from '@/components/intake/lifecycle-batch'
import {
  InventorySelection,
  InventorySelectAll,
  InventorySelectItem,
} from '@/components/intake/inventory-selection'
import '@/components/intake/inventory-edit.css'

export default async function Lifecycle({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.lifecycle
  const p = await searchParams
  const stage = lifecycleStage.safeParse(p.stage)
  const parsedSort = lifecycleSort.safeParse(p.sort)
  const sort = parsedSort.success ? parsedSort.data : 'accepted'
  const direction = p.direction === 'desc' ? 'desc' : 'asc'
  const query = typeof p.q === 'string' ? p.q.trim().slice(0, 120) : ''
  const candidatePage =
    typeof p.page === 'string' && /^\d+$/.test(p.page) ? Number(p.page) : 1
  // The RPC offset is a PostgreSQL integer. Malformed or oversized URLs start at page one.
  const requestedPage =
    Number.isSafeInteger(candidatePage) &&
    candidatePage > 0 &&
    (candidatePage - 1) * 25 <= 2_147_483_647
      ? candidatePage
      : 1
  const [paged, runs, policy] = await Promise.all([
    readLifecycleQueuePage(ctx.client, active.id, {
      query,
      sort,
      direction,
      stage: stage.success ? stage.data : undefined,
      offset: (requestedPage - 1) * 25,
    }),
    readMarkdownRuns(ctx.client, active.id),
    readStorePolicy(ctx.client, active.id),
  ])
  // During additive rollout, the old RPC still supplies complete facts. Read all
  // stages so the batch count remains store-wide even when the list is filtered.
  const legacyRows = paged
    ? []
    : await readLifecycleQueue(ctx.client, active.id)
  const needle = query.toLowerCase()
  const filtered = legacyRows.filter(
    (row) =>
      (!stage.success || row.stage === stage.data) &&
      (!query ||
        (row.title ?? '').toLowerCase().includes(needle) ||
        ('I-' + row.item_id.slice(0, 8)).toLowerCase().includes(needle) ||
        row.item_id.toLowerCase().includes(needle)),
  )
  const total = paged?.total ?? filtered.length
  const pages = Math.max(1, Math.ceil(total / 25))
  const page = Math.min(pages, requestedPage)
  const pageHref = (
    number: number,
    key: LifecycleSort = sort,
    dir: 'asc' | 'desc' = direction,
  ) =>
    `/intake/lifecycle?${new URLSearchParams({ q: query, stage: stage.success ? stage.data : '', page: String(number), sort: key, direction: dir })}`
  if (requestedPage > pages) redirect(pageHref(pages))
  // Legacy rollout fallback: retain the same deterministic order for facts
  // available before the new overload is installed.
  const field = {
    title: 'title',
    seller: 'seller_name',
    price: 'current_price_ore',
    stage: 'stage',
    accepted: 'accepted_at',
    periodEnd: 'period_end',
  } as const
  filtered.sort((a, b) => {
    const av = a[field[sort]],
      bv = b[field[sort]]
    const compared =
      av == null
        ? bv == null
          ? 0
          : 1
        : bv == null
          ? -1
          : (typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : String(av)
                  .toLowerCase()
                  .localeCompare(String(bv).toLowerCase())) *
            (direction === 'asc' ? 1 : -1)
    return compared || a.item_id.localeCompare(b.item_id)
  })
  const visible = paged?.rows ?? filtered.slice((page - 1) * 25, page * 25)
  const photos = new Map(
    (
      await Promise.all(
        [0, 20].map((offset) =>
          readItemPhotos(
            ctx.client,
            active.id,
            visible.slice(offset, offset + 20).map((r) => r.item_id),
          ),
        ),
      )
    )
      .flat()
      .map((p) => [p.itemId, p]),
  )
  const clearHref =
    '/intake/lifecycle?' + new URLSearchParams({ sort, direction })
  // Both search and stage filters affect the list, never the batch command.
  const dueCount =
    paged?.dueCount ??
    legacyRows.filter((row) => row.stage === 'markdown_due').length
  const write = active.role !== 'readonly'
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
    })
  const stageLabel = (value: keyof typeof d.stages) =>
    value === 'markdown_due' ? all.items.markdownWaiting : d.stages[value]
  const header = (key: LifecycleSort, label: string, numeric = false) => (
    <InventorySortHeader
      selected={sort === key}
      direction={direction}
      href={pageHref(
        1,
        key,
        sort === key && direction === 'asc' ? 'desc' : 'asc',
      )}
      label={label}
      d={all.items.directory}
      numeric={numeric}
    />
  )
  return (
    <div className="lifecycle-page">
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.listIntro}</p>
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>

      <details className="card intake-form lifecycle-automation">
        <summary>{d.storeMarkdowns}</summary>
        <p>
          {policy.policy.automaticMarkdowns === true ? d.agentOn : d.agentOff}
        </p>
        <p className="lifecycle-scope">{d.searchScopeHint}</p>
        {write && (
          <ApplyDueMarkdowns
            key={`${active.id}-${dueCount}`}
            tenantId={active.id}
            dueCount={dueCount}
            d={d}
            intake={all.intake}
          />
        )}
        {runs.length > 0 && (
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                {when(run.created_at)} · {d.modes[run.mode]} ·{' '}
                {run.applied_count} {d.applied}
              </li>
            ))}
          </ul>
        )}
      </details>
      <div className="inventory-panel lifecycle-table-panel">
        <WorkingForm action="/intake/lifecycle" className="inventory-filters">
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="direction" value={direction} />
          <div className="inventory-basic">
            <div className="field">
              <label htmlFor="lifecycle-query">{d.search}</label>
              <input
                key={query}
                id="lifecycle-query"
                type="search"
                name="q"
                maxLength={120}
                defaultValue={query}
                placeholder={d.searchHint}
              />
            </div>
            <div className="field">
              <label htmlFor="lifecycle-stage">{d.filter}</label>
              <select
                id="lifecycle-stage"
                name="stage"
                defaultValue={stage.success ? stage.data : ''}
              >
                <option value="">{d.all}</option>
                {lifecycleStage.options.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-secondary">
              {all.items.searchButton}
            </button>
            {(query || stage.success) && (
              <Link className="text-link" href={clearHref}>
                {all.items.clearFilters}
              </Link>
            )}
          </div>
        </WorkingForm>
        <InventorySelection
          key={`${query}-${page}-${sort}-${direction}-${stage.success ? stage.data : ''}`}
          ids={visible.map((r) => r.item_id)}
        >
          {write && (
            <div className="inventory-selection-toolbar">
              <LifecycleBatch
                tenantId={active.id}
                currency={currency}
                locale={ctx.locale}
                d={all}
              />
            </div>
          )}
          <InventoryTableShell label={d.title}>
            <thead>
              <tr>
                {write && (
                  <th scope="col">
                    <InventorySelectAll label={all.itemWorkflow.selectAll} />
                  </th>
                )}
                {header('title', all.items.item)}
                <th scope="col">{all.quickIntake.category}</th>
                {header('seller', all.quickIntake.seller)}
                {header('price', all.quickIntake.price, true)}
                {header('stage', all.items.stage)}
                {header('accepted', all.items.directory.registered)}
                {header('periodEnd', all.items.directory.periodEnd)}
                <th scope="col">{all.items.ownership}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <LifecycleTableRow
                  id={r.item_id}
                  key={`${r.item_id}-${query}-${page}-${sort}-${direction}`}
                  title={r.title || all.items.item}
                  selection={
                    write ? (
                      <InventorySelectItem
                        id={r.item_id}
                        label={r.title || all.items.item}
                      />
                    ) : undefined
                  }
                  initiallyOpen={query !== '' && total === 1}
                  photo={
                    photos.get(r.item_id)?.defaultPhotoId ? (
                      <ItemPhotoPreview
                        tenantId={active.id}
                        itemId={r.item_id}
                        photoId={photos.get(r.item_id)!.defaultPhotoId!}
                        count={photos.get(r.item_id)!.photos.length}
                        title={r.title || all.items.item}
                        d={all.itemPhotos}
                      />
                    ) : null
                  }
                  cells={
                    <>
                      <td>
                        <span
                          className="inventory-cell-text"
                          title={r.category ?? undefined}
                        >
                          {r.category || '—'}
                        </span>
                      </td>
                      <td>
                        {r.seller_id ? (
                          <Link
                            className="inventory-seller"
                            href={`/intake/sellers/${r.seller_id}`}
                            title={r.seller_name ?? undefined}
                          >
                            {r.seller_name || '—'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="inventory-number inventory-price">
                        {r.current_price_ore === null
                          ? '—'
                          : `${formatSignedOre(r.current_price_ore)} ${currency}`}
                      </td>
                      <td className="inventory-state">
                        <span
                          className={`lifecycle-status lifecycle-status-${r.stage}`}
                        >
                          {stageLabel(r.stage)}
                        </span>
                      </td>
                      <td className="inventory-date">{when(r.accepted_at)}</td>
                      <td className="inventory-date">{when(r.period_end)}</td>
                      <td>
                        <span
                          className="lifecycle-ownership"
                          title={all.items.ownershipKinds[r.ownership]}
                        >
                          {r.ownership === 'store' ? (
                            <Store size={16} aria-hidden="true" />
                          ) : (
                            <Handshake size={16} aria-hidden="true" />
                          )}
                          <span className="sr-only">
                            {all.items.ownershipKinds[r.ownership]}
                          </span>
                        </span>
                      </td>
                    </>
                  }
                >
                  <small className="lifecycle-reference">
                    {'I-' + r.item_id.slice(0, 8).toUpperCase()}
                  </small>
                  <Link
                    className="text-link"
                    href={`/intake/items/${r.item_id}`}
                  >
                    {all.items.open} →
                  </Link>
                  <p>
                    {d.accepted} {when(r.accepted_at)}
                    {r.due_step !== null
                      ? ` · ${d.due.replace('{step}', String(r.due_step)).replace('{percent}', String(r.due_percent))}`
                      : ''}
                  </p>
                  {r.collection_deadline &&
                    !['sold', 'ended'].includes(r.stage) && (
                      <p>
                        {d.collectionDeadline} {when(r.collection_deadline)}
                      </p>
                    )}
                  {write && !['sold', 'ended'].includes(r.stage) && (
                    <LifecycleActions
                      key={`${r.item_id}-${r.stage}-${r.due_step ?? 0}`}
                      tenantId={active.id}
                      itemId={r.item_id}
                      dueStep={r.due_step}
                      endOfPeriodAction={r.end_of_period_action}
                      collectionDeadline={r.collection_deadline}
                      collectionDue={r.collection_due === true}
                      priceEdit={all.priceEdit}
                      d={d}
                      intake={all.intake}
                    />
                  )}
                </LifecycleTableRow>
              ))}
            </tbody>
          </InventoryTableShell>
        </InventorySelection>
        {total === 0 && (
          <p className="inventory-message">{query ? d.noMatches : d.empty}</p>
        )}
        <InventoryFooter
          total={total}
          offset={(page - 1) * 25}
          count={visible.length}
          page={page}
          pages={pages}
          href={pageHref}
          d={all.items}
        />
      </div>
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.lifecycle.title)
