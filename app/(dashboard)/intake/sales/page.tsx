import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readItems } from '@/lib/engine/items'
import { readSales, readSoldItemIds, formatOre } from '@/lib/engine/sales'
import { SaleForm } from '@/components/intake/sale-form'

export default async function Sales() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.sales
  const [sales, items] = await Promise.all([
    readSales(ctx.client, active.id),
    readItems(ctx.client, active.id),
  ])
  const sold = await readSoldItemIds(
    ctx.client,
    active.id,
    items.map((i) => i.id),
  )
  const unsold = items
    .filter((i) => !sold.has(i.id))
    .map((i) => ({
      id: i.id,
      priceOre: i.priceOre,
      label: `${all.items.originKinds[i.origin_kind]} · ${
        i.priceOre === null ? '—' : `${formatOre(i.priceOre)} ${currency}`
      } · ${i.id.slice(0, 8)}`,
    }))
  const when = (iso: string) =>
    new Date(iso).toLocaleString(ctx.locale === 'sv' ? 'sv-SE' : 'en-GB', {
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
      <div className="intake-grid">
        {active.role !== 'readonly' ? (
          <SaleForm
            key={active.id}
            tenantId={active.id}
            currency={currency}
            items={unsold}
            d={d}
            intake={all.intake}
          />
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
