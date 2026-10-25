import { itemFilterHref } from '@/lib/engine/item-filter-navigation'
import { WorkingForm } from '@/components/platform/working-form'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from '@/components/platform/working-link'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { currentMonthPeriod, economyPeriod } from '@/lib/engine/economy'
import {
  readStockReport,
  readStockAssortments,
  readStockLifecycle,
} from '@/lib/engine/stock-report'
import { economyFormat } from '@/lib/intake/economy-format'
import { ChevronDown } from 'lucide-react'

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
  const initialTab = params.from || params.to ? 'sales' : 'overview'
  const ownership =
    params.ownership === 'store' || params.ownership === 'consignment'
      ? params.ownership
      : ''
  const itemsHref = (filter: Record<string, string>) =>
    itemFilterHref(ownership ? { ownership } : {}, filter)
  const report = await readStockReport(
    ctx.client,
    active.id,
    period,
    ownership || undefined,
  )
  const assortments = await readStockAssortments(
    ctx.client,
    active.id,
    ownership || undefined,
  )
  const lifecycle = await readStockLifecycle(
    ctx.client,
    active.id,
    ownership || undefined,
  )
  const stockStages = [
    'active',
    'on_sale',
    'markdown_due',
    'period_ending',
    'period_ended',
  ] as const
  const stageLabel = (stage: (typeof stockStages)[number]) =>
    stage === 'active'
      ? all.sellerPortal.itemFilters.active
      : stage === 'markdown_due'
        ? all.items.markdownWaiting
        : all.lifecycle.stages[stage]
  const format = economyFormat(ctx.locale)
  const money = (ore: number) => format.money(ore, report!.currency)
  const pct = (value: number | null) =>
    value === null ? '—' : format.percent(value)
  const days = (value: number | null) => (value === null ? '—' : String(value))
  return (
    <div className="stock-overview">
      <div className="page-heading workspace-heading">
        <FormHelpHeading
          title={d.title}
          level={1}
          help={{
            label: d.helpLabel,
            steps: [d.scopeHint, d.valueHint, d.ageHint],
          }}
        />
        <div className="workspace-actions">
          <Link className="btn btn-secondary" href="/intake/stocktake">
            {all.stocktake.title}
          </Link>
          <Link className="text-link" href="/intake/items">
            {all.items.title} →
          </Link>
        </div>
      </div>
      {!report && <p>{d.notAvailable}</p>}
      {report &&
        report.total.inStock === 0 &&
        report.total.soldCount === 0 &&
        report.categories.length === 0 && (
          <section
            className="card stock-panel stock-empty"
            aria-label={d.empty}
          >
            <p>{d.empty}</p>
            <Link className="btn btn-primary" href="/intake/quick">
              {all.quickIntake.title}
            </Link>
          </section>
        )}
      <WorkspaceTabs
        id="stock"
        label={d.title}
        toolbar={
          <WorkingForm
            action={`/intake/stock#stock-${initialTab}`}
            data-workspace-filter
            className="stock-ownership-filter stock-period stock-report-filters"
          >
            <div className="field">
              <label htmlFor="stock-ownership">{all.items.ownership}</label>
              <select
                id="stock-ownership"
                name="ownership"
                defaultValue={ownership}
              >
                <option value="">{all.items.allOwnerships}</option>
                <option value="consignment">
                  {all.items.ownershipKinds.consignment}
                </option>
                <option value="store">{all.items.ownershipKinds.store}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="stock-from">{e.from}</label>
              <input
                id="stock-from"
                name="from"
                type="date"
                defaultValue={period.from}
                required
                aria-describedby="stock-period-hint"
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
                aria-describedby="stock-period-hint"
              />
            </div>
            <button className="btn btn-primary">{e.show}</button>
            <p id="stock-period-hint" className="muted">
              {d.salesHint}
            </p>
            {!requested.success && (params.from || params.to) && (
              <p role="alert">{e.periodInvalid}</p>
            )}
          </WorkingForm>
        }
        initial={initialTab}
        tabs={[
          {
            id: 'overview',
            label: d.tabs.overview,
            content: report && (
              <div className="stock-current-grid">
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
                    </div>
                  </dl>
                </section>
                {lifecycle ? (
                  <>
                    <section
                      className="stock-stages"
                      aria-label={d.stageHeading}
                    >
                      <h2>{d.stageHeading}</h2>
                      <div className="stock-stage-grid">
                        {stockStages.map((stage) => (
                          <article
                            className="card stock-stage-card"
                            key={stage}
                          >
                            <Link
                              className="stock-stage-count"
                              href={itemsHref({ stage })}
                              aria-label={`${stageLabel(stage)}: ${lifecycle.stages[stage]}`}
                            >
                              <span>{stageLabel(stage)}</span>
                              <strong>{lifecycle.stages[stage]}</strong>
                            </Link>
                            {(stage === 'markdown_due' ||
                              stage === 'period_ended') && (
                              <Link
                                className="text-link"
                                href={`/intake/lifecycle?stage=${stage}`}
                                aria-label={`${all.lifecycle.title}: ${stageLabel(stage)}`}
                              >
                                {all.lifecycle.title} →
                              </Link>
                            )}
                          </article>
                        ))}
                        <article className="card stock-stage-card stock-stage-nearing">
                          <Link
                            className="stock-stage-count"
                            href={itemsHref({ periodWindow: 'next7days' })}
                            aria-label={`${d.nearingEnd}: ${lifecycle.nearingPeriodEnd}`}
                          >
                            <span>{d.nearingEnd}</span>
                            <strong>{lifecycle.nearingPeriodEnd}</strong>
                          </Link>
                          <p className="muted">{d.nearingHint}</p>
                        </article>
                      </div>
                      <nav
                        className="inventory-filter-links stock-stage-links"
                        aria-label={all.items.stage}
                      >
                        {(['ended', 'sold'] as const).map((stage) => (
                          <Link
                            className="inventory-filter-chip"
                            key={stage}
                            href={itemsHref({ stage })}
                          >
                            {all.lifecycle.stages[stage]}
                          </Link>
                        ))}
                      </nav>
                    </section>
                    <section aria-label={d.ownershipValue}>
                      <h2>{d.ownershipValue}</h2>
                      <dl className="stock-metrics">
                        {(['consignment', 'store'] as const).map((kind) => (
                          <div className="card" key={kind}>
                            <dt>{all.items.ownershipKinds[kind]}</dt>
                            <dd>
                              {money(lifecycle.ownership[kind].stockValueOre)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  </>
                ) : (
                  <p role="status">{d.notAvailable}</p>
                )}
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
              </div>
            ),
          },
          {
            id: 'categories',
            label: d.tabs.categories,
            content: report && (
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
                            <th scope="row">
                              {c.category ? (
                                <Link
                                  className="text-link"
                                  href={itemsHref({ category: c.category })}
                                >
                                  {c.category}
                                </Link>
                              ) : (
                                d.uncategorised
                              )}
                            </th>
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
            ),
          },
          {
            id: 'assortments',
            label: d.assortments,
            content: (
              <section className="card stock-panel" aria-label={d.assortments}>
                <h2>{d.assortments}</h2>
                <div className="stock-table-wrap">
                  <table className="stock-table">
                    <thead>
                      <tr>
                        <th>{all.itemWorkflow.group}</th>
                        <th>{d.inStock}</th>
                        <th>{d.stockValue}</th>
                        <th>{d.averageAge}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assortments.groups.map((g) => (
                        <tr key={g.id ?? 'none'}>
                          <th scope="row">
                            {g.id ? (
                              <Link
                                className="text-link"
                                href={itemsHref({ assortment: g.id })}
                              >
                                {g.name}
                              </Link>
                            ) : (
                              d.noAssortment
                            )}
                          </th>
                          <td data-label={d.inStock}>{g.inStock}</td>
                          <td data-label={d.stockValue}>
                            {format.money(
                              g.stockValueOre,
                              assortments.currency,
                            )}
                          </td>
                          <td data-label={d.averageAge}>
                            {days(g.averageAgeDays)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ),
          },
          {
            id: 'sales',
            label: d.tabs.sales,
            content: (
              <section
                className="card stock-panel stock-sales-panel"
                aria-label={d.salesPeriod}
              >
                <FormHelpHeading
                  title={d.salesPeriod}
                  help={{
                    label: d.salesHelpLabel,
                    steps: [d.salesHint, d.notice],
                  }}
                />
                {report && (
                  <>
                    <p className="muted">
                      {e.showing} {format.dateRange(report.from, report.to)}
                    </p>
                    <dl className="stock-metrics stock-sales-metrics">
                      <div>
                        <dt>{d.sold}</dt>
                        <dd>{format.number(report.total.soldCount)}</dd>
                      </div>
                      <div>
                        <dt>{d.soldGross}</dt>
                        <dd>
                          {format.money(
                            report.total.soldGrossOre,
                            report.currency,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>{d.margin}</dt>
                        <dd>
                          {format.money(
                            report.total.marginOre,
                            report.currency,
                          )}
                        </dd>
                      </div>
                    </dl>
                    <details className="stock-details">
                      <summary>
                        <ChevronDown aria-hidden="true" size={20} />
                        {d.more}
                      </summary>
                      <FormHelpHeading
                        title={d.metricsHeading}
                        help={{
                          label: d.metricsHelpLabel,
                          steps: [d.definitions, d.missingHint],
                        }}
                      />
                      <dl className="stock-metrics stock-extra-metrics">
                        <div>
                          <dt>{d.marginPercent}</dt>
                          <dd>{pct(report.total.marginPercent)}</dd>
                        </div>
                        <div>
                          <dt>{d.sellThrough}</dt>
                          <dd>{pct(report.total.sellThroughPercent)}</dd>
                        </div>
                      </dl>
                      <div className="stock-table-wrap">
                        <table
                          className="stock-table stock-sales-table"
                          role="table"
                        >
                          <thead>
                            <tr>
                              <th>{d.category}</th>
                              <th>{d.sold}</th>
                              <th>{d.margin}</th>
                              <th>{d.marginPercent}</th>
                              <th>{d.sellThrough}</th>
                              <th>{d.daysToSale}</th>
                              <th>{d.oldest}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.categories.map((c) => (
                              <tr key={c.category || '-'}>
                                <th scope="row">
                                  {c.category || d.uncategorised}
                                </th>
                                <td data-label={d.sold}>
                                  {format.number(c.soldCount)}
                                </td>
                                <td data-label={d.margin}>
                                  {format.money(c.marginOre, report.currency)}
                                </td>
                                <td data-label={d.marginPercent}>
                                  {pct(c.marginPercent)}
                                </td>
                                <td data-label={d.sellThrough}>
                                  {pct(c.sellThroughPercent)}
                                </td>
                                <td data-label={d.daysToSale}>
                                  {c.averageDaysToSale === null
                                    ? '—'
                                    : format.number(c.averageDaysToSale)}
                                </td>
                                <td data-label={d.oldest}>
                                  {c.oldestAgeDays === null
                                    ? '—'
                                    : format.number(c.oldestAgeDays)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </>
                )}
              </section>
            ),
          },
        ]}
      />
    </div>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.stock.title)
