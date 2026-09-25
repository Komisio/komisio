import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  itemStage,
  readItems,
  readItemsOverview,
  readItemsOverviewPage,
  formatOre,
} from '@/lib/engine/items'

export default async function Items({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.items,
    params = await searchParams,
    query = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : '',
    stageParam = typeof params.stage === 'string' ? params.stage : '',
    stage = itemStage.safeParse(stageParam).success ? stageParam : '',
    pageSize = 25,
    requestedPage =
      typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
        ? Number(params.page)
        : 1
  const pageHref = (page: number) => {
    const search = new URLSearchParams()
    if (query) search.set('q', query)
    if (stage) search.set('stage', stage)
    if (page > 1) search.set('page', String(page))
    return '/intake/items' + (search.size ? '?' + search.toString() : '')
  }
  const when = (value: string) =>
    new Date(value).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
    })
  // The overview arrives with its migration; until then the plain list stands.
  const paged = await readItemsOverviewPage(ctx.client, active.id, {
    query,
    stage: stage || undefined,
    limit: pageSize,
    offset: (requestedPage - 1) * pageSize,
  })
  const pageCount = paged ? Math.max(1, Math.ceil(paged.total / pageSize)) : 1
  if (paged && requestedPage > pageCount) redirect(pageHref(pageCount))
  const overview =
    paged ??
    (await readItemsOverview(ctx.client, active.id, {
      query,
      stage: stage || undefined,
    }))
  const items = overview ? [] : await readItems(ctx.client, active.id)
  return (
    <>
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>
      <section className="card intake-form">
        <h2>{d.list}</h2>
        {overview && (
          <form
            key={query + ':' + stage}
            action="/intake/items"
            className="items-directory-filters"
            role="search"
          >
            <div className="field">
              <label htmlFor="items-q">{d.search}</label>
              <input
                id="items-q"
                name="q"
                defaultValue={query}
                maxLength={120}
                placeholder={d.searchHint}
              />
            </div>
            <div className="field">
              <label htmlFor="items-stage">{d.stage}</label>
              <select id="items-stage" name="stage" defaultValue={stage}>
                <option value="">{d.allStages}</option>
                {itemStage.options.map((s) => (
                  <option key={s} value={s}>
                    {all.lifecycle.stages[s]}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary">{d.searchButton}</button>
            {(query || stage) && (
              <Link className="btn btn-secondary" href="/intake/items">
                {d.clearFilters}
              </Link>
            )}
          </form>
        )}
        {overview && (
          <p>
            <small>
              {paged && paged.total > 0
                ? d.showingRange
                    .replace('{from}', String(paged.offset + 1))
                    .replace('{to}', String(paged.offset + paged.items.length))
                    .replace('{total}', String(paged.total))
                : d.showing
                    .replace('{shown}', String(overview.items.length))
                    .replace('{total}', String(overview.total))}
            </small>
          </p>
        )}
        <ul className="intake-list">
          {overview?.items.map((i) => (
            <li key={i.id} className="intake-bag">
              <div>
                <Link className="text-link" href={`/intake/items/${i.id}`}>
                  {i.title ?? d.originKinds[i.originKind]} ·{' '}
                  {i.currentPriceOre === null
                    ? '—'
                    : `${formatOre(i.currentPriceOre)} ${currency}`}
                </Link>
                <br />
                <small>
                  {i.category ? `${i.category} · ` : ''}
                  {d.originKinds[i.originKind]} ·{' '}
                  {d.ownershipKinds[i.ownership]} ·{' '}
                  {all.lifecycle.stages[i.stage]} · {when(i.acceptedAt)}
                </small>
              </div>
            </li>
          ))}
          {items.map((i) => (
            <li key={i.id} className="intake-bag">
              <div>
                <Link className="text-link" href={`/intake/items/${i.id}`}>
                  {d.originKinds[i.origin_kind]} ·{' '}
                  {i.priceOre === null
                    ? '—'
                    : `${formatOre(i.priceOre)} ${currency}`}
                </Link>
                <br />
                <small>
                  {d.ownershipKinds[i.ownership]} · {when(i.accepted_at)}
                </small>
              </div>
            </li>
          ))}
        </ul>
        {paged && pageCount > 1 && (
          <nav className="items-directory-pagination" aria-label={d.pagination}>
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
                .replace('{pages}', String(pageCount))}
            </span>
            {requestedPage < pageCount && (
              <Link
                className="btn btn-secondary"
                href={pageHref(requestedPage + 1)}
              >
                {d.nextPage}
              </Link>
            )}
          </nav>
        )}
        {!items.length && !overview?.items.length && (
          <p>{query || stage ? d.noMatches : d.empty}</p>
        )}
      </section>
    </>
  )
}
