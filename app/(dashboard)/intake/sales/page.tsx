import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readSales, formatOre, saleProvider } from '@/lib/engine/sales'
import {
  receiptSearch,
  receiptSearchQuery,
} from '@/lib/intake/sales-navigation'
import { SaleForm } from '@/components/intake/sale-form'
import { ArrowRight } from 'lucide-react'

export default async function Sales({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.sales
  const parsed = receiptSearch.safeParse(await searchParams)
  if (!parsed.success) notFound()
  const search = parsed.data
  const query = receiptSearchQuery(search)
  const filtered = !!query
  const sales = await readSales(ctx.client, active.id, {
    externalId: search.reference || undefined,
    provider: search.provider || undefined,
  })
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  return (
    <div className="sales-overview">
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
      </div>
      <p className="intake-notice">{d.notice}</p>
      <div className="sales-page">
        {active.role !== 'readonly' ? (
          <details className="sale-manual">
            <summary>{d.recordHeading}</summary>
            <SaleForm
              key={active.id}
              tenantId={active.id}
              currency={currency}
              d={d}
              intake={all.intake}
              leaveUnsaved={all.leaveUnsaved}
            />
          </details>
        ) : (
          <p>{all.intake.readOnly}</p>
        )}
        <section className="card sales-register" aria-labelledby="sales-recent">
          <h2 id="sales-recent">{filtered ? d.searchResults : d.recent}</h2>
          <form
            key={query}
            method="get"
            action="/intake/sales"
            role="search"
            aria-label={d.findReceipt}
            className="receipt-search"
          >
            <div className="field">
              <label htmlFor="receipt-reference">{d.reference}</label>
              <input
                id="receipt-reference"
                name="reference"
                type="search"
                maxLength={200}
                defaultValue={search.reference}
                aria-describedby="receipt-search-hint"
              />
              <small id="receipt-search-hint">{d.receiptSearchHint}</small>
            </div>
            <div className="field">
              <label htmlFor="receipt-provider">{d.source}</label>
              <select
                id="receipt-provider"
                name="provider"
                defaultValue={search.provider}
              >
                <option value="">{d.allSources}</option>
                {saleProvider.options.map((provider) => (
                  <option key={provider} value={provider}>
                    {d.providers[provider]}
                  </option>
                ))}
              </select>
            </div>
            <div className="receipt-search-actions">
              <button className="btn btn-secondary">{d.findReceipt}</button>
              {filtered && (
                <Link className="text-link" href="/intake/sales">
                  {d.showLatest}
                </Link>
              )}
            </div>
          </form>
          <p className="muted">{filtered ? d.filteredHint : d.listHint}</p>
          <ul className="sales-register-list">
            {sales.map((s) => (
              <li key={s.id}>
                <Link
                  className="sales-register-row"
                  href={`/intake/sales/${s.id}${query}`}
                >
                  <span className="sales-register-main">
                    <strong>
                      {formatOre(s.total_ore)} {currency}
                    </strong>
                    <span>{d.providers[s.provider]}</span>
                  </span>
                  <time dateTime={s.occurred_at}>{when(s.occurred_at)}</time>
                  <span className="sales-register-status">
                    {d.statuses[s.status]}
                  </span>
                  <span className="sales-register-open">
                    {d.open}
                    <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {!sales.length && <p>{filtered ? d.noReceipts : d.empty}</p>}
        </section>
      </div>
    </div>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.sales.title)
