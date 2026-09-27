import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  readLifecycleQueue,
  readLifecycleQueuePage,
  readMarkdownRuns,
  lifecycleStage,
} from '@/lib/engine/lifecycle'
import { readStorePolicy } from '@/lib/engine/store-policy'
import { ApplyDueMarkdowns } from '@/components/intake/apply-due-markdowns'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { LifecycleActions } from '@/components/intake/lifecycle-actions'

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
  const query = typeof p.q === 'string' ? p.q.trim().slice(0, 120) : ''
  const candidatePage =
    typeof p.page === 'string' && /^\d+$/.test(p.page) ? Number(p.page) : 1
  // The RPC offset is a PostgreSQL integer. Malformed or oversized URLs start at page one.
  const requestedPage =
    Number.isSafeInteger(candidatePage) &&
    candidatePage > 0 &&
    (candidatePage - 1) * 20 <= 2_147_483_647
      ? candidatePage
      : 1
  const [paged, runs, policy] = await Promise.all([
    readLifecycleQueuePage(ctx.client, active.id, {
      query,
      stage: stage.success ? stage.data : undefined,
      offset: (requestedPage - 1) * 20,
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
  const pages = Math.max(1, Math.ceil(total / 20))
  const page = Math.min(pages, requestedPage)
  const pageHref = (number: number) =>
    `/intake/lifecycle?${new URLSearchParams({ q: query, stage: stage.success ? stage.data : '', page: String(number) })}`
  if (requestedPage > pages) redirect(pageHref(pages))
  const visible = paged?.rows ?? filtered.slice((page - 1) * 20, page * 20)
  const clearHref =
    '/intake/lifecycle?' +
    new URLSearchParams({ stage: stage.success ? stage.data : '' })
  // Both search and stage filters affect the list, never the batch command.
  const dueCount =
    paged?.dueCount ??
    legacyRows.filter((row) => row.stage === 'markdown_due').length
  const write = active.role !== 'readonly'
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
    })
  return (
    <>
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.listIntro}</p>
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>

      <details className="card intake-form lifecycle-automation">
        <summary>{d.agentHeading}</summary>
        <p>
          {policy.policy.automaticMarkdowns === true ? d.agentOn : d.agentOff}
        </p>
        {(query || stage.success) && <p>{d.searchScopeHint}</p>}
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
      <form action="/intake/lifecycle" className="lifecycle-filter">
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
                {d.stages[s]}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary">{all.items.searchButton}</button>
        {query && (
          <Link className="text-link" href={clearHref}>
            {d.clearSearch}
          </Link>
        )}
      </form>
      <p>{d.matches.replace('{count}', String(total))}</p>
      <section className="card lifecycle-list">
        {total === 0 && <p>{query ? d.noMatches : d.empty}</p>}
        {visible.map((r) => (
          <details
            id={'lifecycle-' + r.item_id}
            key={r.item_id}
            className="lifecycle-row"
            open={query !== '' && total === 1}
          >
            <summary>
              <span className="lifecycle-item">
                {r.title || `${all.items.open} · ${r.item_id.slice(0, 8)}`}
                <small className="lifecycle-reference">
                  {'I-' + r.item_id.slice(0, 8).toUpperCase()}
                </small>
              </span>
              <span className={`lifecycle-status lifecycle-status-${r.stage}`}>
                {d.stages[r.stage]}
              </span>
              <strong className="lifecycle-price">
                {r.current_price_ore === null
                  ? '—'
                  : `${formatSignedOre(r.current_price_ore)} ${currency}`}
              </strong>
              <span className="lifecycle-end">
                {d.periodEnd} {when(r.period_end)}
              </span>
            </summary>
            <div className="lifecycle-detail">
              <Link className="text-link" href={`/intake/items/${r.item_id}`}>
                {all.items.open} →
              </Link>
              <p>
                {d.accepted} {when(r.accepted_at)}
                {r.due_step !== null
                  ? ` · ${d.due.replace('{step}', String(r.due_step)).replace('{percent}', String(r.due_percent))}`
                  : ''}
              </p>
              {write && !['sold', 'ended'].includes(r.stage) && (
                <LifecycleActions
                  key={`${r.item_id}-${r.stage}-${r.due_step ?? 0}`}
                  tenantId={active.id}
                  itemId={r.item_id}
                  dueStep={r.due_step}
                  endOfPeriodAction={r.end_of_period_action}
                  d={d}
                  intake={all.intake}
                />
              )}
            </div>
          </details>
        ))}
        {pages > 1 && (
          <nav className="lifecycle-pagination" aria-label={d.title}>
            {page > 1 && (
              <Link className="btn btn-secondary" href={pageHref(page - 1)}>
                {d.previous}
              </Link>
            )}
            <span>
              {page} / {pages}
            </span>
            {page < pages && (
              <Link className="btn btn-secondary" href={pageHref(page + 1)}>
                {d.next}
              </Link>
            )}
          </nav>
        )}
      </section>
    </>
  )
}
