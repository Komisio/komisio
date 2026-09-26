import Link from 'next/link'
import './handovers.css'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readHandover,
  readHandoverQueue,
  readHandoverQueuePage,
} from '@/lib/engine/handovers'
import { readStorePolicy } from '@/lib/engine/store-policy'
import { HandoverQueue } from '@/components/intake/handover-queue'

/** Announced handovers: receive at the counter, which records the bag receipt. */
export default async function Handovers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.handovers
  const params = await searchParams
  const rawFocus = params.focus
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const status = z
    .enum(['all', 'open', 'received', 'cancelled'])
    .catch('all')
    .parse(params.status)
  const requestedPage =
    typeof params.page === 'string' && /^[1-9]\d{0,6}$/.test(params.page)
      ? Number(params.page)
      : 1
  const href = (page: number) => {
    const query = new URLSearchParams()
    if (q) query.set('q', q)
    if (status !== 'all') query.set('status', status)
    if (page > 1) query.set('page', String(page))
    return '/intake/handovers' + (query.size ? '?' + query.toString() : '')
  }
  const focus = z.uuid().safeParse(rawFocus)
  if (rawFocus !== undefined && !focus.success) notFound()
  const [result, policy] = await Promise.all([
    focus.success
      ? readHandover(ctx.client, active.id, focus.data).then((row) => ({
          handovers: row ? [row] : [],
          total: row ? 1 : 0,
          offset: 0,
        }))
      : readHandoverQueuePage(ctx.client, active.id, {
          query: q,
          status,
          offset: (requestedPage - 1) * 25,
        }),
    readStorePolicy(ctx.client, active.id),
  ])
  const pages = result ? Math.max(1, Math.ceil(result.total / 25)) : 1
  if (!focus.success && result && requestedPage > pages) redirect(href(pages))
  const rows =
    result?.handovers ?? (await readHandoverQueue(ctx.client, active.id))
  if (focus.success && rows.length === 0) notFound()
  const common = all.sellersList
  const pager =
    !focus.success && result && pages > 1 ? (
      <nav className="seller-directory-pagination" aria-label={d.pagination}>
        {requestedPage > 1 && (
          <Link className="btn btn-secondary" href={href(requestedPage - 1)}>
            {common.previousPage}
          </Link>
        )}
        <span>
          {common.pageOf
            .replace('{page}', String(requestedPage))
            .replace('{pages}', String(pages))}
        </span>
        {requestedPage < pages && (
          <Link className="btn btn-secondary" href={href(requestedPage + 1)}>
            {common.nextPage}
          </Link>
        )}
      </nav>
    ) : null
  const enabled = policy.policy.custodySources.includes('seller_dropoff')
  const manages = active.role === 'owner' || active.role === 'admin'
  const showQueue = rows.length > 0 || !!q || status !== 'all'
  return (
    <div className="handover-page">
      <div className="page-heading">
        <h1>{d.title}</h1>
        {enabled && <p>{d.intro}</p>}
        {focus.success && (
          <p>
            <Link className="btn btn-secondary" href="/intake/handovers">
              {d.backToQueue}
            </Link>
          </p>
        )}
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>
      {!enabled && (
        <section className="card handover-disabled" aria-label={d.disabled}>
          <p>{d.disabled}</p>
          {manages ? (
            <Link
              className="btn btn-secondary"
              href="/settings#policy-custodySources"
            >
              {d.settings}
            </Link>
          ) : (
            <p>{d.askOwner}</p>
          )}
        </section>
      )}
      {!showQueue && enabled && <p className="intake-notice">{d.empty}</p>}
      {showQueue && (
        <section className="card intake-form">
          {!focus.success && (
            <>
              {result ? (
                <form
                  key={q + ':' + status}
                  action="/intake/handovers"
                  className="seller-directory-search handover-queue-search"
                >
                  <label htmlFor="handovers-q">{d.search}</label>
                  <div className="row">
                    <input
                      id="handovers-q"
                      name="q"
                      type="search"
                      defaultValue={q}
                      maxLength={120}
                      placeholder={d.searchHint}
                    />
                    <div className="field">
                      <label htmlFor="handovers-status">{d.statusFilter}</label>
                      <select
                        id="handovers-status"
                        name="status"
                        defaultValue={status}
                      >
                        <option value="all">{d.allStatuses}</option>
                        {(['open', 'received', 'cancelled'] as const).map(
                          (value) => (
                            <option key={value} value={value}>
                              {d.statuses[value]}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    <button className="btn btn-secondary">
                      {common.searchButton}
                    </button>
                    {(q || status !== 'all') && (
                      <Link className="text-link" href="/intake/handovers">
                        {all.items.clearFilters}
                      </Link>
                    )}
                  </div>
                </form>
              ) : (
                <p role="status">{d.limited}</p>
              )}
              {result && (
                <p>
                  <small>
                    {d.showingRange
                      .replace(
                        '{from}',
                        String(result.total ? result.offset + 1 : 0),
                      )
                      .replace('{to}', String(result.offset + rows.length))
                      .replace('{total}', String(result.total))}
                  </small>
                </p>
              )}
              {pager}
            </>
          )}
          <HandoverQueue
            key={`${active.id}-${rows.map((r) => `${r.id}:${r.status}`).join(',')}`}
            tenantId={active.id}
            rows={rows}
            write={active.role !== 'readonly'}
            focus={focus.success ? focus.data : null}
            locale={ctx.locale}
            d={
              result && (q || status !== 'all')
                ? { ...d, empty: d.noMatches }
                : d
            }
            intake={all.intake}
          />
          {pager}
        </section>
      )}
    </div>
  )
}
