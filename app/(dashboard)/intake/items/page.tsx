import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  itemStage,
  readItems,
  readItemsOverview,
  formatOre,
} from '@/lib/engine/items'

export default async function Items({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.items,
    params = await searchParams,
    query = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : '',
    stageParam = typeof params.stage === 'string' ? params.stage : '',
    stage = itemStage.safeParse(stageParam).success ? stageParam : ''
  const when = (value: string) =>
    new Date(value).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
    })
  // The overview arrives with its migration; until then the plain list stands.
  const overview = await readItemsOverview(ctx.client, active.id, {
    query,
    stage: stage || undefined,
  })
  const items = overview ? [] : await readItems(ctx.client, active.id)
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
        {overview && (
          <form action="/intake/items" className="row" role="search">
            <div className="field">
              <label htmlFor="items-q">{d.search}</label>
              <input
                id="items-q"
                name="q"
                defaultValue={query}
                maxLength={120}
                placeholder={d.searchHint}
              />
            </div>
            <div className="field">
              <label htmlFor="items-stage">{d.stage}</label>
              <select id="items-stage" name="stage" defaultValue={stage}>
                <option value="">{d.allStages}</option>
                {itemStage.options.map((s) => (
                  <option key={s} value={s}>
                    {all.lifecycle.stages[s]}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn">{d.searchButton}</button>
          </form>
        )}
        {overview && (
          <p>
            <small>
              {d.showing
                .replace('{shown}', String(overview.items.length))
                .replace('{total}', String(overview.total))}
            </small>
          </p>
        )}
        <ul className="intake-list">
          {overview?.items.map((i) => (
            <li key={i.id} className="intake-bag">
              <div>
                <Link className="text-link" href={`/intake/items/${i.id}`}>
                  {i.title ?? d.originKinds[i.originKind]} ·{' '}
                  {i.currentPriceOre === null
                    ? '—'
                    : `${formatOre(i.currentPriceOre)} ${currency}`}
                </Link>
                <br />
                <small>
                  {i.category ? `${i.category} · ` : ''}
                  {d.originKinds[i.originKind]} ·{' '}
                  {d.ownershipKinds[i.ownership]} ·{' '}
                  {all.lifecycle.stages[i.stage]} · {when(i.acceptedAt)}
                </small>
              </div>
            </li>
          ))}
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
                  {d.ownershipKinds[i.ownership]} · {when(i.accepted_at)}
                </small>
              </div>
            </li>
          ))}
        </ul>
        {!items.length && !overview?.items.length && (
          <p>{query || stage ? d.noMatches : d.empty}</p>
        )}
      </section>
    </>
  )
}
