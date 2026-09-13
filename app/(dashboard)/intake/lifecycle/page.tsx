import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import {
  readLifecycleQueue,
  readMarkdownRuns,
  lifecycleStage,
} from '@/lib/engine/lifecycle'
import { readStorePolicy } from '@/lib/engine/store-policy'
import { ApplyDueMarkdowns } from '@/components/intake/apply-due-markdowns'
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
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.lifecycle
  const p = await searchParams
  const stage = lifecycleStage.safeParse(p.stage)
  const [rows, runs, policy] = await Promise.all([
    readLifecycleQueue(
      ctx.client,
      active.id,
      stage.success ? stage.data : undefined,
    ),
    readMarkdownRuns(ctx.client, active.id),
    readStorePolicy(ctx.client, active.id),
  ])
  const dueCount = rows.filter((r) => r.stage === 'markdown_due').length
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
      <section className="card intake-form" aria-label={d.agentHeading}>
        <h2>{d.agentHeading}</h2>
        <p>
          {policy.policy.automaticMarkdowns === true ? d.agentOn : d.agentOff}
        </p>
        {write && (
          <ApplyDueMarkdowns
            key={`${active.id}-${dueCount}`}
            tenantId={active.id}
            dueCount={dueCount}
            d={d}
            intake={all.intake}
          />
        )}
        {runs.length > 0 && (
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                {when(run.created_at)} · {d.modes[run.mode]} ·{' '}
                {run.applied_count} {d.applied}
              </li>
            ))}
          </ul>
        )}
      </section>
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
                : `${formatSignedOre(r.current_price_ore)} ${currency}`}
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
