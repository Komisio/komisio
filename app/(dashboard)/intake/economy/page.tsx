import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  currentMonthPeriod,
  economyPeriod,
  readEconomySummary,
} from '@/lib/engine/economy'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { readEconomyBrief, renderBrief } from '@/lib/engine/brief'
import { automationIdentity, readAutomation } from '@/lib/engine/automation'
import { AutomationSwitch } from '@/components/intake/automation-switch'

/** One page of the store's numbers for a period; the read model is SQL. */
export default async function Economy({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.economy
  const params = await searchParams
  const requested = economyPeriod.safeParse({
    from: params.from,
    to: params.to,
  })
  const period = requested.success ? requested.data : currentMonthPeriod()
  const summary = await readEconomySummary(ctx.client, active.id, period)
  const briefKind = params.brief === 'month' ? 'month' : 'week'
  const briefRead = await readEconomyBrief(ctx.client, active.id, {
    kind: briefKind,
  })
  const brief = briefRead ? renderBrief(briefRead, all.brief) : null
  const grants =
    active.role === 'owner' ? await readAutomation(ctx.client, active.id) : null
  const money = (ore: number) => `${formatSignedOre(ore)} ${summary.currency}`
  const t = summary.totals
  const vatModes = all.sales.vatModes as Record<string, string>
  const rows: [string, string][] = [
    [d.sales, `${t.salesCount} · ${t.linesCount} ${d.lines}`],
    [d.gross, money(t.grossOre)],
    [d.vat, money(t.vatOre)],
    [d.net, money(t.netOre)],
    [d.commission, money(t.commissionOre)],
    [d.commissionVat, money(t.commissionVatOre)],
    [d.sellerCredit, money(t.sellerCreditOre)],
    [d.returns, `${t.returnsCount} · ${money(t.refundsOre)}`],
    [d.creditReversed, money(t.creditReversedOre)],
    [d.payoutsPaid, `${t.payoutsPaidCount} · ${money(t.payoutsPaidOre)}`],
  ]
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>
      <p className="intake-notice">{d.notice}</p>
      <div className="intake-grid">
        <section className="card intake-form" aria-label={d.periodHeading}>
          <h2>{d.periodHeading}</h2>
          <form method="get" className="intake-fields">
            {!requested.success && (params.from || params.to) && (
              <p role="alert">{d.periodInvalid}</p>
            )}
            <div className="field">
              <label htmlFor="economy-from">{d.from}</label>
              <input
                id="economy-from"
                name="from"
                type="date"
                defaultValue={period.from}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="economy-to">{d.to}</label>
              <input
                id="economy-to"
                name="to"
                type="date"
                defaultValue={period.to}
                required
              />
            </div>
            <button className="btn">{d.show}</button>
          </form>
          <p>
            {d.showing} {summary.from} – {summary.to}
          </p>
        </section>
        <section className="card intake-form" aria-label={all.brief.heading}>
          <h2>{all.brief.heading}</h2>
          <p>{all.brief.hint}</p>
          <p>
            <Link
              className="text-link"
              href="/intake/economy?brief=week"
              aria-current={briefKind === 'week' ? 'page' : undefined}
            >
              {all.brief.week}
            </Link>{' '}
            ·{' '}
            <Link
              className="text-link"
              href="/intake/economy?brief=month"
              aria-current={briefKind === 'month' ? 'page' : undefined}
            >
              {all.brief.month}
            </Link>
          </p>
          {brief && (
            <>
              <h3>{brief.title}</h3>
              <ul>
                {brief.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        {active.role === 'owner' && (
          <AutomationSwitch
            key={`${active.id}-${grants?.find((g) => g.scope === 'weekly_brief')?.id ?? 'none'}`}
            tenantId={active.id}
            scope="weekly_brief"
            grants={grants}
            configured={automationIdentity() !== null}
            canEdit
            t={all.brief.email}
          />
        )}
        <section className="card intake-form" aria-label={d.totalsHeading}>
          <h2>{d.totalsHeading}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(t.perMode).length > 0 && (
            <>
              <h3>{d.perMode}</h3>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>{d.mode}</th>
                      <th>{d.lines}</th>
                      <th>{d.gross}</th>
                      <th>{d.vat}</th>
                      <th>{d.net}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(t.perMode).map(([mode, m]) => (
                      <tr key={mode}>
                        <td>{vatModes[mode] ?? mode}</td>
                        <td>{m.lines}</td>
                        <td>{money(m.grossOre)}</td>
                        <td>{money(m.vatOre)}</td>
                        <td>{money(m.netOre)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
        <section className="card intake-form" aria-label={d.liabilityHeading}>
          <h2>{d.liabilityHeading}</h2>
          <p>{d.liabilityHint}</p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <tbody>
                <tr>
                  <th scope="row">{d.owed}</th>
                  <td>{money(summary.liability.owedOre)}</td>
                </tr>
                <tr>
                  <th scope="row">{d.available}</th>
                  <td>{money(summary.liability.availableOre)}</td>
                </tr>
                <tr>
                  <th scope="row">{d.reserved}</th>
                  <td>{money(summary.liability.reservedOre)}</td>
                </tr>
                <tr>
                  <th scope="row">{d.openPayouts}</th>
                  <td>
                    {summary.openPayouts.count} ·{' '}
                    {money(summary.openPayouts.amountOre)}{' '}
                    <Link className="text-link" href="/intake/payouts">
                      {all.payouts.title}
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section className="card intake-form" aria-label={d.daysHeading}>
          <h2>{d.daysHeading}</h2>
          {summary.days.length === 0 && <p>{d.noSales}</p>}
          {summary.days.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{d.date}</th>
                    <th>{d.sales}</th>
                    <th>{d.gross}</th>
                    <th>{d.sellerCredit}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.days.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{day.salesCount}</td>
                      <td>{money(day.grossOre)}</td>
                      <td>{money(day.sellerCreditOre)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
