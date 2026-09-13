import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readLifecycleQueue, lifecycleStage } from '@/lib/engine/lifecycle'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { LifecycleActions } from '@/components/intake/lifecycle-actions'

export default async function Lifecycle({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.lifecycle
  const p = await searchParams
  const stage = lifecycleStage.safeParse(p.stage)
  const rows = await readLifecycleQueue(
    ctx.client,
    active.id,
    stage.success ? stage.data : undefined,
  )
  const write = active.role !== 'readonly'
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(ctx.locale === 'sv' ? 'sv-SE' : 'en-GB', {
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
      <form action="/intake/lifecycle">
        <label htmlFor="lifecycle-stage">{d.filter}</label>
        <select
          id="lifecycle-stage"
          name="stage"
          defaultValue={stage.success ? stage.data : ''}
        >
          <option value="">{d.all}</option>
          {lifecycleStage.options.map((s) => (
            <option key={s} value={s}>
              {d.stages[s]}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary">{d.filter}</button>
      </form>
      <section className="card intake-form">
        {rows.length === 0 && <p>{d.empty}</p>}
        {rows.map((r) => (
          <div key={r.item_id} className="intake-notice">
            <strong>
              <Link className="text-link" href={`/intake/items/${r.item_id}`}>
                {all.items.open}
              </Link>{' '}
              · {d.stages[r.stage]} ·{' '}
              {r.current_price_ore === null
                ? '—'
                : `${formatSignedOre(r.current_price_ore)} SEK`}
            </strong>
            <p>
              {d.accepted} {when(r.accepted_at)} · {d.periodEnd}{' '}
              {when(r.period_end)}
              {r.due_step !== null
                ? ` · ${d.due.replace('{step}', String(r.due_step)).replace('{percent}', String(r.due_percent))}`
                : ''}
            </p>
            {write && !['sold', 'ended'].includes(r.stage) && (
              <LifecycleActions
                key={`${r.item_id}-${r.stage}-${r.due_step ?? 0}`}
                tenantId={active.id}
                itemId={r.item_id}
                dueStep={r.due_step}
                endOfPeriodAction={r.end_of_period_action}
                d={d}
                intake={all.intake}
              />
            )}
          </div>
        ))}
      </section>
    </>
  )
}
