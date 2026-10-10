import { z } from 'zod'
import { notFound, redirect } from 'next/navigation'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { requirePlatform } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary } from '@/lib/i18n'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { EventTime } from '@/components/ui/event-time'
import { StocktakeDownload } from '@/components/intake/stocktake-download'
import {
  readStocktake,
  readStocktakeSessions,
  stocktakeFilter,
} from '@/lib/engine/stocktake'
import {
  StocktakeWorkspace,
  StocktakeStart,
  StocktakeScan,
  StocktakeFinding,
  StocktakeFinish,
} from '@/components/intake/stocktake'

export default async function Stocktake({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    d = dictionary(ctx.locale),
    s = d.stocktake,
    params = await searchParams
  const historyPage =
    z.coerce.number().int().min(1).max(100000).safeParse(params.historyPage)
      .data ?? 1
  const history = await readStocktakeSessions(
    ctx.client,
    active.id,
    historyPage,
  )
  const sessions = history.rows
  const requested = z.uuid().safeParse(params.session)
  if (params.session && !requested.success) notFound()
  const selected = requested.success ? requested.data : history.activeId
  const filter = stocktakeFilter.safeParse(params.filter).data ?? 'all'
  const page =
    z.coerce.number().int().min(1).max(20001).safeParse(params.page).data ?? 1
  const report = selected
    ? await readStocktake(
        ctx.client,
        active.id,
        selected,
        filter,
        (page - 1) * 50,
      )
    : null
  if (selected && !report) notFound()
  const readonly = active.role === 'readonly'
  const historyPages = Math.max(1, Math.ceil(history.total / 20))
  const historyLink = (
    target: number,
    session = selected,
    f: string = filter,
    itemPage = page,
  ) =>
    `/intake/stocktake?${new URLSearchParams({ ...(session ? { session } : {}), filter: f, page: String(itemPage), historyPage: String(target) })}`
  if (historyPage > historyPages) redirect(historyLink(historyPages))
  const link = (f: string = filter, p: number = 1) =>
    historyLink(historyPage, selected, f, p)
  return (
    <div className="stack stocktake-page">
      <div className="page-heading">
        <FormHelpHeading
          title={s.title}
          level={1}
          help={{ label: s.help, steps: [s.scope, s.effects] }}
        />
        <Link className="text-link" href="/intake/stock">
          {s.back}
        </Link>
      </div>
      {!report && !readonly && <StocktakeStart tenantId={active.id} d={d} />}
      {report && (
        <StocktakeWorkspace>
          <div className="row wrap">
            <h2>{report.closed ? s.closed : s.open}</h2>
            {report.closed && (
              <Link className="text-link" href="/intake/stocktake">
                {history.activeId ? s.open : s.start}
              </Link>
            )}
          </div>
          <dl className="stocktake-metrics">
            {(['total', 'unchecked', 'deviations'] as const).map((k) => (
              <div className="card" key={k}>
                <dt>{s[k]}</dt>
                <dd>{report.counts[k]}</dd>
              </div>
            ))}
          </dl>
          {!readonly && !report.closed && (
            <StocktakeScan
              key={report.id}
              tenantId={active.id}
              sessionId={report.id}
              d={d}
            />
          )}
          <nav className="row wrap" aria-label={s.title}>
            {(['all', 'unchecked', 'deviations'] as const).map((f) => (
              <Link
                key={f}
                className="text-link"
                aria-current={f === filter ? 'page' : undefined}
                href={link(f)}
              >
                {s[f]}
              </Link>
            ))}
          </nav>
          {report.closed && filter !== 'unchecked' && (
            <StocktakeDownload
              key={`${active.id}:${report.id}:${filter}`}
              tenantId={active.id}
              sessionId={report.id}
              filter={filter}
              s={s}
            />
          )}
          {report.rows.length === 0 && <p>{s.empty}</p>}
          <ul className="stocktake-list">
            {report.rows.map((item) => (
              <li key={item.id} className="card">
                <div className="row wrap">
                  <Link className="text-link" href={`/intake/items/${item.id}`}>
                    {item.title || `I-${item.id.slice(0, 8).toUpperCase()}`}
                  </Link>
                  <span>{s[item.observation]}</span>
                </div>
                <small>I-{item.id.slice(0, 8).toUpperCase()}</small>
                {item.changed && <p>{s.changed}</p>}
                {!item.expected && <p>{s.unexpected}</p>}
                {item.reason && <p>{item.reason}</p>}
                {!readonly && !report.closed && (
                  <StocktakeFinding
                    key={`${item.id}:${item.version}`}
                    tenantId={active.id}
                    sessionId={report.id}
                    item={item}
                    d={d}
                  />
                )}
              </li>
            ))}
          </ul>
          <nav className="row wrap" aria-label={s.title}>
            {page > 1 && (
              <Link className="text-link" href={link(filter, page - 1)}>
                {s.previous}
              </Link>
            )}
            {page * 50 < report.matching && (
              <Link className="text-link" href={link(filter, page + 1)}>
                {s.next}
              </Link>
            )}
          </nav>
          {!readonly && !report.closed && (
            <StocktakeFinish
              key={`${report.id}:${report.version}`}
              tenantId={active.id}
              report={report}
              d={d}
            />
          )}
          {report.history.length > 0 && (
            <details>
              <summary>{s.history}</summary>
              <ul>
                {report.history.map((h) => (
                  <li key={h.seq}>
                    <EventTime value={h.at} locale={ctx.locale} /> · {h.actor} ·{' '}
                    {h.kind === 'closed'
                      ? s.closed
                      : h.observation
                        ? s[h.observation]
                        : ''}
                    {h.item_id && (
                      <> · I-{h.item_id.slice(0, 8).toUpperCase()}</>
                    )}
                    {h.reason && <p>{h.reason}</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </StocktakeWorkspace>
      )}
      {sessions.length > 0 && (
        <details className="stocktake-session-history" open={historyPage > 1}>
          <summary>{s.recent}</summary>
          <ul>
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  className="text-link"
                  href={historyLink(historyPage, session.id, 'all', 1)}
                  aria-current={session.id === selected ? 'page' : undefined}
                >
                  <EventTime value={session.at} locale={ctx.locale} /> ·{' '}
                  {session.closed ? s.closed : s.open}
                </Link>
              </li>
            ))}
          </ul>
          {historyPages > 1 && (
            <nav className="row wrap" aria-label={s.recent}>
              {historyPage > 1 && (
                <Link className="text-link" href={historyLink(historyPage - 1)}>
                  {s.previous}
                </Link>
              )}
              <span>
                {historyPage} / {historyPages}
              </span>
              {historyPage < historyPages && (
                <Link className="text-link" href={historyLink(historyPage + 1)}>
                  {s.next}
                </Link>
              )}
            </nav>
          )}
        </details>
      )}
    </div>
  )
}
export const generateMetadata = () =>
  platformPageMetadata((d) => d.stocktake.title)
