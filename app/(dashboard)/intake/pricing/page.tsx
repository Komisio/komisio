import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { PricingCohortDownload } from '@/components/intake/pricing-cohort-download'
import { requirePlatform } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary, intlLocale } from '@/lib/i18n'
import {
  pricingPeriod,
  readPricingFollowUp,
  recentPricingPeriod,
  type PricingFollowUp,
} from '@/lib/engine/pricing-follow-up'
import { evaluatePricing } from '@/lib/assistance/pricing-evaluation'

export const generateMetadata = () =>
  platformPageMetadata((d) => d.pricingFollowUp.title)

export default async function Pricing({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  if (!['owner', 'admin'].includes(ctx.active!.role)) notFound()
  const all = dictionary(ctx.locale),
    d = all.pricingFollowUp
  const params = await searchParams,
    recent = recentPricingPeriod()
  const parsed = pricingPeriod.safeParse({
    from: params.from ?? recent.from,
    to: params.to ?? recent.to,
  })
  const period = parsed.success ? parsed.data : recent
  let report: PricingFollowUp | null = null
  let error = parsed.success ? '' : d.periodInvalid
  if (parsed.success) {
    try {
      report = await readPricingFollowUp(ctx.client, ctx.active!.id, period)
    } catch (e) {
      if (e instanceof Error && e.message === 'PERIOD_TOO_LARGE')
        error = d.narrowPeriod
      else if (e instanceof Error && e.message === 'INVALID_INPUT')
        error = d.periodInvalid
      else throw e
    }
  }
  const metrics = report?.cohort ? evaluatePricing(report.cohort) : null
  const number = new Intl.NumberFormat(intlLocale(ctx.locale), {
    maximumFractionDigits: 1,
  })
  const percent = (n: number | null) =>
    n === null ? '—' : `${number.format(n)} %`
  const omitted = report
    ? report.withoutAssessment +
      report.otherMarketOrCurrency +
      (metrics?.withoutEstimate ?? 0)
    : 0
  return (
    <div className="stock-overview pricing-follow-up">
      <Link href="/intake/submissions" className="text-link">
        {all.submissions.queue}
      </Link>
      <div className="page-heading">
        <FormHelpHeading
          title={d.title}
          level={1}
          help={{
            label: d.helpLabel,
            steps: [d.scopeHelp, d.comparisonHelp, d.downloadHelp],
          }}
        />
      </div>
      <section className="card stock-panel" aria-label={d.period}>
        <h2>{d.period}</h2>
        <form method="get" className="stock-period">
          <div className="field">
            <label htmlFor="pricing-from">{all.economy.from}</label>
            <input
              id="pricing-from"
              name="from"
              type="date"
              defaultValue={period.from}
              max={recent.to}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pricing-to">{all.economy.to}</label>
            <input
              id="pricing-to"
              name="to"
              type="date"
              defaultValue={period.to}
              max={recent.to}
              required
            />
          </div>
          <button className="btn btn-primary">{all.economy.show}</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </section>
      {report && (
        <>
          <dl className="stock-metrics stock-sales-metrics">
            <div className="card">
              <dt>{d.received}</dt>
              <dd>{report.receivedItems}</dd>
            </div>
            <div className="card">
              <dt>{d.estimates}</dt>
              <dd>{metrics?.estimates ?? 0}</dd>
            </div>
            <div className="card">
              <dt>{d.comparableSales}</dt>
              <dd>{metrics?.completedSale.count ?? 0}</dd>
            </div>
          </dl>
          <section className="card stock-panel" aria-label={d.comparison}>
            <h2>{d.comparison}</h2>
            {report.marketCountry && (
              <p className="muted">
                {new Intl.DisplayNames([intlLocale(ctx.locale)], {
                  type: 'region',
                }).of(report.marketCountry)}{' '}
                · {report.currency}
              </p>
            )}
            {!report.marketCountry ? (
              <Link href="/settings">{d.setMarket}</Link>
            ) : !metrics ? (
              <p>{d.empty}</p>
            ) : (
              <>
                <div className="stock-table-wrap">
                  <table className="stock-table">
                    <thead>
                      <tr>
                        <th>{d.compareWith}</th>
                        <th>{d.count}</th>
                        <th>{d.difference}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          label: d.acceptedPrice,
                          metric: metrics.staffDecision,
                        },
                        { label: d.soldPrice, metric: metrics.completedSale },
                      ].map(({ label, metric }) => {
                        return (
                          <tr key={label}>
                            <th scope="row">{label}</th>
                            <td data-label={d.count}>{metric.count}</td>
                            <td data-label={d.difference}>
                              {percent(metric.meanAbsoluteErrorPercent)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <PricingCohortDownload
                  cohort={report.cohort!}
                  date={report.asOf.slice(0, 10)}
                  label={d.download}
                />
              </>
            )}
            {omitted > 0 && (
              <p className="muted">
                {d.omitted.replace('{count}', String(omitted))}
              </p>
            )}
            {(metrics?.returnedSalesExcluded ?? 0) > 0 && (
              <p className="muted">
                {d.returned.replace(
                  '{count}',
                  String(metrics!.returnedSalesExcluded),
                )}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
