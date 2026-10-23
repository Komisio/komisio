import { notFound } from 'next/navigation'
import Link from '@/components/platform/working-link'
import { WorkingForm } from '@/components/platform/working-form'
import { EventTime } from '@/components/ui/event-time'
import { InventoryFooter } from '@/components/intake/inventory-table-shell'
import { requirePlatform } from '@/lib/platform/context'
import { can } from '@/lib/platform/permissions'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary, intlLocale } from '@/lib/i18n'
import { activityQuery, readStoreActivity } from '@/lib/engine/store-activity'

export const generateMetadata = () =>
  platformPageMetadata((d) => d.activity.title)

export default async function StoreActivity({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePlatform(),
    active = ctx.active!,
    d = dictionary(ctx.locale),
    a = d.activity
  if (!can(active.role, 'audit.read'))
    return <p role="alert">{d.errors.FORBIDDEN}</p>
  const parsed = activityQuery.safeParse(await searchParams)
  if (!parsed.success)
    return (
      <section className="card">
        <h1>{a.title}</h1>
        <p role="alert">{a.invalid}</p>
        <Link href="/settings/activity">{a.reset}</Link>
      </section>
    )
  const q = parsed.data,
    result = await readStoreActivity(ctx.client, active.id, q)
  const pages = Math.max(1, Math.min(40001, Math.ceil(result.total / 25)))
  if (q.page > pages) notFound()
  const href = (page: number) => {
    const params = new URLSearchParams({
      from: q.from,
      to: q.to,
      actor: q.actor,
      kind: q.kind,
      page: String(page),
    })
    return `/settings/activity?${params}`
  }
  const actions = Object.entries(d.events)
  const groups = Object.entries(a.areas).sort((x, y) =>
    x[1].localeCompare(y[1], intlLocale(ctx.locale)),
  )
  const names = (name: string | null, former: boolean) =>
    former ? a.former : name || a.member
  return (
    <>
      <div className="page-heading">
        <h1>{a.title}</h1>
        <p>{a.intro}</p>
      </div>
      <WorkingForm
        action="/settings/activity"
        className="card activity-filters"
      >
        <div className="field">
          <label htmlFor="activity-from">{a.from}</label>
          <input
            type="date"
            id="activity-from"
            name="from"
            defaultValue={q.from}
          />
        </div>
        <div className="field">
          <label htmlFor="activity-to">{a.to}</label>
          <input type="date" id="activity-to" name="to" defaultValue={q.to} />
        </div>
        <div className="field">
          <label htmlFor="activity-actor">{a.actor}</label>
          <input
            id="activity-actor"
            name="actor"
            list="activity-actors"
            defaultValue={q.actor}
            aria-describedby="activity-actor-hint"
          />
          <datalist id="activity-actors">
            {result.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {names(actor.name, actor.former)}
              </option>
            ))}
          </datalist>
          <small id="activity-actor-hint">{a.actorHint}</small>
        </div>
        <div className="field">
          <label htmlFor="activity-action">{a.action}</label>
          <select id="activity-action" name="kind" defaultValue={q.kind}>
            <option value="">{a.all}</option>
            {q.kind && !Object.hasOwn(d.events, q.kind) && (
              <option value={q.kind}>{a.unknown}</option>
            )}
            {groups.map(([key, label]) => (
              <optgroup key={key} label={label}>
                {actions
                  .filter(([code]) => code.startsWith(`${key}.`))
                  .map(([code, text]) => (
                    <option key={code} value={code}>
                      {text}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="actions">
          <button className="btn">{a.apply}</button>
          <Link href="/settings/activity" className="btn btn-secondary">
            {a.reset}
          </Link>
        </div>
      </WorkingForm>
      <section className="card activity-results" aria-label={a.title}>
        {!result.rows.length && <p>{a.empty}</p>}
        <ol className="activity-list">
          {result.rows.map((event) => (
            <li key={event.id}>
              <EventTime value={event.occurred_at} locale={ctx.locale} />
              <strong>
                {Object.hasOwn(d.events, event.action)
                  ? d.events[event.action as keyof typeof d.events]
                  : a.unknown}
              </strong>
              <span>
                {event.actor_state === 'system'
                  ? a.system
                  : names(event.actor_name, event.actor_state === 'former')}
              </span>
              <details>
                <summary>{a.details}</summary>
                <dl>
                  <dt>{a.action}</dt>
                  <dd>
                    <code>{event.action}</code>
                  </dd>
                  <dt>{a.actor}</dt>
                  <dd>
                    <code>{event.actor_id ?? a.system}</code>
                  </dd>
                  {event.target_id && (
                    <>
                      <dt>{a.target}</dt>
                      <dd>
                        <code>{event.target_id}</code>
                      </dd>
                    </>
                  )}
                </dl>
              </details>
            </li>
          ))}
        </ol>
        <InventoryFooter
          total={result.total}
          offset={(q.page - 1) * 25}
          count={result.rows.length}
          page={q.page}
          pages={pages}
          href={href}
          d={{ ...d.items, showingRange: a.showingRange }}
          label={a.title}
        />
      </section>
    </>
  )
}
