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
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake/economy">
          {e.title}
        </Link>
      </div>
      <p className="intake-notice">{d.notice}</p>
      <div className="intake-grid">
        <section className="card intake-form" aria-label={e.periodHeading}>
          <h2>{e.periodHeading}</h2>
          <form method="get" className="intake-fields">
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
            <p>
              {e.showing} {report.from} – {report.to}
            </p>
          )}
        </section>
        {!report && <p>{d.notAvailable}</p>}
        {report && (
          <section className="card intake-form" aria-label={d.totalsHeading}>
            <h2>{d.totalsHeading}</h2>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <tbody>
                  <tr>
                    <th scope="row">{d.inStock}</th>
                    <td>
                      {report.total.inStock} ·{' '}
                      {money(report.total.stockValueOre)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{d.sold}</th>
                    <td>
                      {report.total.soldCount} ·{' '}
                      {money(report.total.soldGrossOre)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{d.margin}</th>
                    <td>
                      {money(report.total.marginOre)} ·{' '}
                      {pct(report.total.marginPercent)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{d.sellThrough}</th>
                    <td>{pct(report.total.sellThroughPercent)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{d.age}</th>
                    <td>
                      {d.bucket0} {report.total.ageBuckets.d0to14} ·{' '}
                      {d.bucket15} {report.total.ageBuckets.d15to28} ·{' '}
                      {d.bucket29} {report.total.ageBuckets.d29to42} ·{' '}
                      {d.bucket43} {report.total.ageBuckets.d43plus}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <small>{d.definitions}</small>
            </p>
          </section>
        )}
        {report && (
          <section
            className="card intake-form"
            aria-label={d.categoriesHeading}
          >
            <h2>{d.categoriesHeading}</h2>
            {report.categories.length === 0 && <p>{d.empty}</p>}
            {report.categories.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>{d.category}</th>
                      <th>{d.inStock}</th>
                      <th>{d.stockValue}</th>
                      <th>{d.averageAge}</th>
                      <th>{d.oldest}</th>
                      <th>{d.sold}</th>
                      <th>{d.soldGross}</th>
                      <th>{d.margin}</th>
                      <th>{d.marginPercent}</th>
                      <th>{d.sellThrough}</th>
                      <th>{d.daysToSale}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.categories.map((c) => (
                      <tr key={c.category || '-'}>
                        <td>{c.category || d.uncategorised}</td>
                        <td>{c.inStock}</td>
                        <td>{money(c.stockValueOre)}</td>
                        <td>{days(c.averageAgeDays)}</td>
                        <td>{days(c.oldestAgeDays)}</td>
                        <td>{c.soldCount}</td>
                        <td>{money(c.soldGrossOre)}</td>
                        <td>{money(c.marginOre)}</td>
                        <td>{pct(c.marginPercent)}</td>
                        <td>{pct(c.sellThroughPercent)}</td>
                        <td>{days(c.averageDaysToSale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}
