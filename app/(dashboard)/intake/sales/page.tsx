import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readSales, formatOre } from '@/lib/engine/sales'
import { SaleForm } from '@/components/intake/sale-form'

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
    })
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
        <section className="card intake-form">
          <h2>{d.recent}</h2>
          <ul className="intake-list">
            {sales.map((s) => (
              <li key={s.id} className="intake-bag">
                <div>
                  <Link className="text-link" href={`/intake/sales/${s.id}`}>
                    {formatOre(s.total_ore)} {currency} ·{' '}
                    {d.providers[s.provider]}
                  </Link>
                  <br />
                  <small>
                    {when(s.occurred_at)} · {s.external_id} ·{' '}
                    {d.statuses[s.status]}
                  </small>
                </div>
              </li>
            ))}
          </ul>
          {!sales.length && <p>{d.empty}</p>}
        </section>
      </div>
    </>
  )
}
