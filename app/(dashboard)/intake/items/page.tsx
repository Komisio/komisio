import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readItems, formatOre } from '@/lib/engine/items'

export default async function Items() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.items
  const items = await readItems(ctx.client, active.id)
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
      <section className="card intake-form">
        <h2>{d.list}</h2>
        <ul className="intake-list">
          {items.map((i) => (
            <li key={i.id} className="intake-bag">
              <div>
                <Link className="text-link" href={`/intake/items/${i.id}`}>
                  {d.originKinds[i.origin_kind]} ·{' '}
                  {i.priceOre === null
                    ? '—'
                    : `${formatOre(i.priceOre)} ${currency}`}
                </Link>
                <br />
                <small>
                  {d.ownershipKinds[i.ownership]} ·{' '}
                  {new Date(i.accepted_at).toLocaleString(
                    ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                    { timeZone: 'Europe/Stockholm' },
                  )}
                </small>
              </div>
            </li>
          ))}
        </ul>
        {!items.length && <p>{d.empty}</p>}
      </section>
    </>
  )
}
