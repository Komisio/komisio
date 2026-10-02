import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readSales, formatOre } from '@/lib/engine/sales'
import { SaleForm } from '@/components/intake/sale-form'
import { ArrowRight } from 'lucide-react'

export default async function Sales() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.sales
  const sales = await readSales(ctx.client, active.id)
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
            />
          </details>
        ) : (
          <p>{all.intake.readOnly}</p>
        )}
        <section className="card sales-register" aria-labelledby="sales-recent">
          <h2 id="sales-recent">{d.recent}</h2>
          <p className="muted">{d.listHint}</p>
          <ul className="sales-register-list">
            {sales.map((s) => (
              <li key={s.id}>
                <Link
                  className="sales-register-row"
                  href={`/intake/sales/${s.id}`}
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
          {!sales.length && <p>{d.empty}</p>}
        </section>
      </div>
    </div>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.sales.title)
