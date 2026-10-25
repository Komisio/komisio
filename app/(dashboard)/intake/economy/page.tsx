import { SellerTypeTotals } from '@/components/intake/seller-type-totals'
import { EconomyPeriodForm } from '@/components/intake/economy-period-form'
import { economyFormat } from '@/lib/intake/economy-format'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from '@/components/platform/working-link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  currentMonthPeriod,
  economyPeriod,
  readEconomySummary,
} from '@/lib/engine/economy'
import { readEconomyBrief, renderBrief } from '@/lib/engine/brief'
import { automationIdentity, readAutomation } from '@/lib/engine/automation'
import { AutomationSwitch } from '@/components/intake/automation-switch'
import {
  readChainEconomySummary,
  readChainOverview,
  type ChainEconomySummary,
} from '@/lib/engine/chains'

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
  const briefHref = (kind: 'week' | 'month') =>
    `/intake/economy?${new URLSearchParams({ ...period, brief: kind })}#economy-brief`
  const briefRead = await readEconomyBrief(ctx.client, active.id, {
    kind: briefKind,
  })
  const format = economyFormat(ctx.locale)
  const brief = briefRead ? renderBrief(briefRead, all.brief, format) : null
  const grants =
    active.role === 'owner' ? await readAutomation(ctx.client, active.id) : null
  // The chain view needs owner or admin in every store; a refusal is shown, not thrown.
  const chain =
    active.role === 'owner' || active.role === 'admin'
      ? await readChainOverview(ctx.client, active.id)
      : null
  let chainSummary: ChainEconomySummary | null = null,
    chainRefused = false
  if (chain)
    try {
      chainSummary = await readChainEconomySummary(ctx.client, chain.id, period)
    } catch {
      chainRefused = true
    }
  const money = (ore: number) => format.money(ore, summary.currency)
  const t = summary.totals
  const vatModes = d.vatModes as Record<string, string>
  const rows: [string, string][] = [
    [d.sales, format.number(t.salesCount)],
    [d.lines, format.number(t.linesCount)],
    [d.gross, money(t.grossOre)],
    [d.vat, money(t.vatOre)],
    [d.net, money(t.netOre)],
    [d.commission, money(t.commissionOre)],
    [d.commissionVat, money(t.commissionVatOre)],
    [d.sellerCredit, money(t.sellerCreditOre)],
    [d.returns, format.number(t.returnsCount)],
    [d.refunds, money(t.refundsOre)],
    [d.creditReversed, money(t.creditReversedOre)],
    [d.payoutCount, format.number(t.payoutsPaidCount)],
    [d.payoutsPaid, money(t.payoutsPaidOre)],
  ]
  return (
    <div className="economy-page">
      <div className="page-heading">
        <FormHelpHeading
          title={d.title}
          level={1}
          help={{ label: d.helpLabel, steps: [d.intro] }}
        />
      </div>
      <SellerTypeTotals
        totals={summary.sellerTypes}
        d={all.sellerDetails.business}
        labels={all.economy}
        locale={ctx.locale}
        currency={summary.currency}
      />
      <WorkspaceTabs
        id="economy"
        label={d.title}
        toolbarTabs={['overview', 'amounts', 'days']}
        toolbar={
          <div className="economy-layout">
            <section
              className="card economy-period"
              aria-label={d.periodHeading}
            >
              <h2>{d.periodHeading}</h2>
              <EconomyPeriodForm
                key={`${ctx.locale}-${period.from}-${period.to}-${briefKind}`}
                from={period.from}
                to={period.to}
                locale={ctx.locale}
                brief={
                  params.brief === 'week' || params.brief === 'month'
                    ? briefKind
                    : undefined
                }
                invalid={
                  !requested.success && Boolean(params.from || params.to)
                }
                t={d}
              />
              <p className="muted economy-period-caption">
                {d.showing} {format.date(summary.from)} –{' '}
                {format.date(summary.to)}
              </p>
            </section>
          </div>
        }
        initial={params.brief ? 'reports' : 'overview'}
        tabs={[
          {
            id: 'overview',
            label: d.tabs.overview,
            content: (
              <div className="economy-layout">
                <section
                  className="economy-overview"
                  aria-label={d.totalsHeading}
                >
                  <h2>{d.totalsHeading}</h2>
                  <dl className="economy-metrics">
                    <div className="card economy-metric economy-metric-primary">
                      <dt>{d.salesAmount}</dt>
                      <dd>{money(t.grossOre)}</dd>
                      <dd className="economy-metric-hint">{d.grossHint}</dd>
                    </div>
                    <div className="card economy-metric">
                      <dt>{d.commission}</dt>
                      <dd>{money(t.commissionOre)}</dd>
                      <dd className="economy-metric-hint">
                        {d.commissionHint}
                      </dd>
                    </div>
                    <div className="card economy-metric">
                      <dt>{d.payoutsPaid}</dt>
                      <dd>{money(t.payoutsPaidOre)}</dd>
                    </div>
                  </dl>
                  <div className="economy-activity">
                    <span>
                      {d.sales}: <strong>{format.number(t.salesCount)}</strong>
                    </span>
                    <span>
                      {d.returns}:{' '}
                      <strong>{format.number(t.returnsCount)}</strong>
                    </span>
                    <span>
                      {d.refunds}: <strong>{money(t.refundsOre)}</strong>
                    </span>
                  </div>
                </section>
                <section
                  className="card intake-form economy-liability"
                  aria-label={d.liabilityHeading}
                >
                  <h2>{d.liabilityHeading}</h2>
                  <p className="economy-current-note">{d.liabilityHint}</p>
                  <dl className="economy-balances">
                    <div>
                      <dt>{d.owed}</dt>
                      <dd>{money(summary.liability.owedOre)}</dd>
                    </div>
                    <div>
                      <dt>{d.available}</dt>
                      <dd>{money(summary.liability.availableOre)}</dd>
                    </div>
                    <div>
                      <dt>{d.reserved}</dt>
                      <dd>{money(summary.liability.reservedOre)}</dd>
                    </div>
                  </dl>
                  <div className="economy-payout-status">
                    <p>
                      <strong>
                        {d.openPayouts}:{' '}
                        {format.number(summary.openPayouts.count)}
                      </strong>
                      <span>{money(summary.openPayouts.amountOre)}</span>
                    </p>
                    <Link className="text-link" href="/intake/payouts">
                      {all.payouts.title}
                    </Link>
                  </div>
                </section>
                {chain && (
                  <section
                    className="card intake-form"
                    aria-label={d.chain.heading}
                  >
                    <h2>{d.chain.heading}</h2>
                    <p>
                      {chain.name}: {format.date(period.from)} –{' '}
                      {format.date(period.to)}
                    </p>
                    {chainRefused && <p>{d.chain.refused}</p>}
                    {chainSummary && (
                      <div
                        className="economy-scroll"
                        role="group"
                        tabIndex={0}
                        aria-label={d.chain.heading}
                      >
                        <table className="economy-table">
                          <thead>
                            <tr>
                              <th>{d.chain.store}</th>
                              <th>{d.sales}</th>
                              <th>{d.gross}</th>
                              <th>{d.sellerCredit}</th>
                              <th>{d.payoutsPaid}</th>
                              <th>{d.owed}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {chainSummary.stores.map((s) => (
                              <tr key={s.id}>
                                <td>{s.name}</td>
                                <td>{format.number(s.totals.salesCount)}</td>
                                <td>
                                  {format.money(s.totals.grossOre, s.currency)}
                                </td>
                                <td>
                                  {format.money(
                                    s.totals.sellerCreditOre,
                                    s.currency,
                                  )}
                                </td>
                                <td>
                                  {format.money(
                                    s.totals.payoutsPaidOre,
                                    s.currency,
                                  )}
                                </td>
                                <td>
                                  {format.money(
                                    s.liability.owedOre,
                                    s.currency,
                                  )}
                                </td>
                              </tr>
                            ))}
                            {chainSummary.total && chainSummary.currency && (
                              <tr>
                                <th scope="row">{d.chain.total}</th>
                                <td>
                                  {format.number(chainSummary.total.salesCount)}
                                </td>
                                <td>
                                  {format.money(
                                    chainSummary.total.grossOre,
                                    chainSummary.currency,
                                  )}
                                </td>
                                <td>
                                  {format.money(
                                    chainSummary.total.sellerCreditOre,
                                    chainSummary.currency,
                                  )}
                                </td>
                                <td>
                                  {format.money(
                                    chainSummary.total.payoutsPaidOre,
                                    chainSummary.currency,
                                  )}
                                </td>
                                <td>
                                  {format.money(
                                    chainSummary.total.owedOre,
                                    chainSummary.currency,
                                  )}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        {chainSummary.mixedCurrencies && <p>{d.chain.mixed}</p>}
                      </div>
                    )}
                  </section>
                )}
              </div>
            ),
          },
          {
            id: 'amounts',
            label: d.details,
            content: (
              <section
                className="card intake-form economy-details"
                aria-label={d.details}
                data-testid="economy-details"
              >
                <h2>{d.details}</h2>
                <p className="muted">{d.notice}</p>
                <div className="economy-scroll">
                  <table className="economy-table economy-values">
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
                    <p className="muted">{d.vatHint}</p>
                    <div
                      className="economy-scroll"
                      role="group"
                      tabIndex={0}
                      aria-label={d.perMode}
                    >
                      <table className="economy-table">
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
                              <td>{format.number(m.lines)}</td>
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
            ),
          },
          {
            id: 'days',
            label: d.tabs.days,
            content: (
              <section className="card intake-form" aria-label={d.daysHeading}>
                <h2>{d.daysHeading}</h2>
                {summary.days.length === 0 && <p>{d.noSales}</p>}
                {summary.days.length > 0 && (
                  <div
                    className="economy-scroll"
                    role="group"
                    tabIndex={0}
                    aria-label={d.daysHeading}
                  >
                    <table className="economy-table">
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
                            <td>{format.date(day.date)}</td>
                            <td>{format.number(day.salesCount)}</td>
                            <td>{money(day.grossOre)}</td>
                            <td>{money(day.sellerCreditOre)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ),
          },
          {
            id: 'reports',
            anchors: ['economy-brief'],
            label: d.tabs.reports,
            content: (
              <section
                className="card intake-form"
                id="economy-brief"
                data-testid="economy-brief"
              >
                <h2>{d.reports}</h2>
                <p className="muted">{d.reportsHint}</p>
                <ul className="economy-report-options">
                  <li>
                    <Link
                      className="text-link"
                      href={briefHref('week')}
                      aria-current={briefKind === 'week' ? 'page' : undefined}
                    >
                      {all.brief.week}
                    </Link>
                    <p>{d.weekHint}</p>
                  </li>
                  <li>
                    <Link
                      className="text-link"
                      href={briefHref('month')}
                      aria-current={briefKind === 'month' ? 'page' : undefined}
                    >
                      {all.brief.month}
                    </Link>
                    <p>{d.monthHint}</p>
                  </li>
                </ul>
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
                {active.role === 'owner' && (
                  <AutomationSwitch
                    key={`${active.id}-${grants?.find((g) => g.scope === 'weekly_brief')?.id ?? 'none'}`}
                    tenantId={active.id}
                    scope="weekly_brief"
                    grants={grants}
                    configured={automationIdentity() !== null}
                    canEdit
                    t={{
                      ...all.brief.email,
                      hint: d.emailHint,
                      enable: d.emailEnable,
                    }}
                  />
                )}
              </section>
            ),
          },
        ]}
      />
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.economy.title)
