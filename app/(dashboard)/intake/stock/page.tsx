import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { currentMonthPeriod, economyPeriod } from '@/lib/engine/economy'
import { readStockReport } from '@/lib/engine/stock-report'
import { formatSignedOre } from '@/lib/engine/seller-ledger'

/** Margin, sell-through and stock age per category; the read model is SQL. */
export default async function Stock({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.stock,
    e = all.economy
  const params = await searchParams
  const requested = economyPeriod.safeParse({
    from: params.from,
    to: params.to,
  })
  const period = requested.success ? requested.data : currentMonthPeriod()
  const report = await readStockReport(ctx.client, active.id, period)
  const money = (ore: number) =>
    `${formatSignedOre(ore)} ${report?.currency ?? ''}`
  const pct = (value: number | null) => (value === null ? '—' : `${value} %`)
  const days = (value: number | null) => (value === null ? '—' : String(value))
  return (
    <main className="stock-overview">
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake/items">
          {all.items.title} →
        </Link>
      </div>
      {!report && <p>{d.notAvailable}</p>}
      {report && (
        <>
          <section aria-label={d.current}>
            <h2>{d.current}</h2>
            <dl className="stock-metrics">
              <div className="card">
                <dt>{d.inStock}</dt>
                <dd>{report.total.inStock}</dd>
              </div>
              <div className="card">
                <dt>{d.stockValue}</dt>
                <dd>{money(report.total.stockValueOre)}</dd>
                <small>{d.valueHint}</small>
              </div>
            </dl>
          </section>
          <section className="card stock-panel" aria-label={d.age}>
            <h2>{d.age}</h2>
            <dl className="stock-age">
              {[
                [d.bucket0, report.total.ageBuckets.d0to14],
                [d.bucket15, report.total.ageBuckets.d15to28],
                [d.bucket29, report.total.ageBuckets.d29to42],
                [d.bucket43, report.total.ageBuckets.d43plus],
              ].map(([label, count]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            <Link className="text-link" href="/intake/lifecycle">
              {all.lifecycle.title} →
            </Link>
          </section>
          <section
            className="card stock-panel"
            aria-label={d.categoriesHeading}
          >
            <h2>{d.categoriesHeading}</h2>
            {!report.categories.length ? (
              <p>{d.empty}</p>
            ) : (
              <div className="stock-table-wrap">
                <table className="stock-table">
                  <thead>
                    <tr>
                      <th>{d.category}</th>
                      <th>{d.inStock}</th>
                      <th>{d.stockValue}</th>
                      <th>{d.averageAge}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.categories.map((c) => (
                      <tr key={c.category || '-'}>
                        <th scope="row">{c.category || d.uncategorised}</th>
                        <td data-label={d.inStock}>{c.inStock}</td>
                        <td data-label={d.stockValue}>
                          {money(c.stockValueOre)}
                        </td>
                        <td data-label={d.averageAge}>
                          {days(c.averageAgeDays)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      <section className="card stock-panel" aria-label={e.periodHeading}>
        <h2>{d.salesPeriod}</h2>
        <form method="get" className="stock-period">
          {!requested.success && (params.from || params.to) && (
            <p role="alert">{e.periodInvalid}</p>
          )}
          <div className="field">
            <label htmlFor="stock-from">{e.from}</label>
            <input
              id="stock-from"
              name="from"
              type="date"
              defaultValue={period.from}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="stock-to">{e.to}</label>
            <input
              id="stock-to"
              name="to"
              type="date"
              defaultValue={period.to}
              required
            />
          </div>
          <button className="btn">{e.show}</button>
        </form>
        {report && (
          <>
            <p className="muted">
              {e.showing} {report.from} – {report.to}
            </p>
            <dl className="stock-metrics stock-sales-metrics">
              <div>
                <dt>{d.sold}</dt>
                <dd>{report.total.soldCount}</dd>
              </div>
              <div>
                <dt>{d.soldGross}</dt>
                <dd>{money(report.total.soldGrossOre)}</dd>
              </div>
              <div>
                <dt>{d.margin}</dt>
                <dd>{money(report.total.marginOre)}</dd>
              </div>
            </dl>
            <details className="stock-details">
              <summary>{d.more}</summary>
              <p>{d.notice}</p>
              <p>{d.definitions}</p>
              <p>
                {d.marginPercent}: {pct(report.total.marginPercent)} ·{' '}
                {d.sellThrough}: {pct(report.total.sellThroughPercent)}
              </p>
              <div className="stock-table-wrap">
                <table className="stock-table">
                  <thead>
                    <tr>
                      <th>{d.category}</th>
                      <th>{d.sold}</th>
                      <th>{d.margin}</th>
                      <th>{d.sellThrough}</th>
                      <th>{d.daysToSale}</th>
                      <th>{d.oldest}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.categories.map((c) => (
                      <tr key={c.category || '-'}>
                        <th scope="row">{c.category || d.uncategorised}</th>
                        <td data-label={d.sold}>{c.soldCount}</td>
                        <td data-label={d.margin}>
                          {money(c.marginOre)} · {pct(c.marginPercent)}
                        </td>
                        <td data-label={d.sellThrough}>
                          {pct(c.sellThroughPercent)}
                        </td>
                        <td data-label={d.daysToSale}>
                          {days(c.averageDaysToSale)}
                        </td>
                        <td data-label={d.oldest}>{days(c.oldestAgeDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>
    </main>
  )
}
