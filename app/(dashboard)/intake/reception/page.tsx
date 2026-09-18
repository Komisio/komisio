import Link from 'next/link'
import { ArrowRight, Plus } from 'lucide-react'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { StartReception } from '@/components/reception/operator'
import {
  readReceptionQueue,
  receptionStage,
  receptionQueueInput,
} from '@/lib/engine/reception-queue'
export default async function Receptions({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    tenant = ctx.active!,
    d = dictionary(ctx.locale).reception,
    p = await searchParams
  const q = typeof p.q === 'string' ? p.q.trim().slice(0, 120) : ''
  const parsed = receptionQueueInput.safeParse({
    tenantId: tenant.id,
    stage: p.stage || undefined,
    before: p.before || undefined,
    beforeId: p.beforeId || undefined,
  })
  const queueInput = parsed.success ? parsed.data : { tenantId: tenant.id }
  const [sellers, recent] = await Promise.all([
    ctx.client
      .from('sellers')
      .select('id,name,email,phone')
      .eq('tenant_id', tenant.id)
      .ilike('name', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
      .order('name')
      .order('id')
      .limit(50),
    readReceptionQueue(ctx.client, queueInput),
  ])
  if (sellers.error) throw new Error('Unable to read reception workspace')
  const exact =
    typeof p.session === 'string' ? z.uuid().safeParse(p.session) : null
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{tenant.name}</div>
        <h1>{d.title}</h1>
        <p>{d.overviewIntro}</p>
      </div>

      <div className="reception-overview">
        <details
          className="card reception-start"
          open={Boolean(q) || (!queueInput.stage && recent.items.length === 0)}
        >
          <summary>
            <Plus size={18} aria-hidden="true" />
            {d.start}
          </summary>
          <div className="reception-start-content">
            <form action="/intake/reception">
              <input
                type="hidden"
                name="stage"
                value={queueInput.stage ?? ''}
              />
              <div className="field">
                <label htmlFor="reception-search">{d.search}</label>
                <div className="row wrap">
                  <input
                    id="reception-search"
                    name="q"
                    defaultValue={q}
                    maxLength={120}
                  />
                  <button className="btn btn-secondary">
                    {d.searchButton}
                  </button>
                </div>
              </div>
            </form>
            {sellers.data.length >= 50 && <small>{d.searchLimit}</small>}
            {tenant.role !== 'readonly' && sellers.data.length > 0 ? (
              <StartReception
                key={q}
                tenantId={tenant.id}
                sellers={sellers.data}
                d={d}
              />
            ) : (
              <p>{sellers.data.length === 0 ? d.noSellers : d.readonly}</p>
            )}
            <Link href="/intake" className="text-link">
              {d.registerSeller}
            </Link>
          </div>
        </details>
        <section className="card reception-queue">
          <div className="reception-queue-heading">
            <h2>{d.queueTitle}</h2>
          </div>
          {!parsed.success && <p role="alert">{d.invalid}</p>}
          <form action="/intake/reception" className="reception-queue-filter">
            <input type="hidden" name="q" value={q} />
            <label htmlFor="queue-stage">{d.queueFilter}</label>
            <select
              id="queue-stage"
              name="stage"
              defaultValue={queueInput.stage ?? ''}
            >
              <option value="">{d.queueAll}</option>
              {receptionStage.options.map((s) => (
                <option key={s} value={s}>
                  {d.queueStages[s]}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary">{d.queueFilter}</button>
          </form>
          <ul className="reception-queue-list">
            {recent.items.map((r) => {
              return (
                <li key={r.session_id}>
                  <Link
                    className={`reception-queue-row reception-state-${r.stage}`}
                    href={`/intake/reception/${r.session_id}`}
                  >
                    <span className="reception-queue-person">
                      <strong>{r.seller_name}</strong>
                      <span>{d.queueActions[r.nextStep]}</span>
                    </span>
                    <span className="reception-queue-status">
                      {d.queueStages[r.stage]}
                    </span>
                    <time dateTime={r.created_at}>
                      {new Date(r.created_at).toLocaleString(
                        intlLocale(ctx.locale),
                        {
                          timeZone: 'Europe/Stockholm',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          year: 'numeric',
                        },
                      )}
                    </time>
                    <span className="reception-queue-open">
                      {d.queueOpen}
                      <ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {recent.items.length === 0 && <p>{d.queueEmpty}</p>}
          <div className="reception-queue-pagination">
            {queueInput.before && (
              <Link
                className="text-link"
                href={`/intake/reception?${new URLSearchParams({ q, stage: queueInput.stage ?? '' })}`}
              >
                {d.queueNewest}
              </Link>
            )}
            {recent.next && (
              <Link
                className="text-link"
                href={`/intake/reception?${new URLSearchParams({ q, stage: queueInput.stage ?? '', ...recent.next })}`}
              >
                {d.queueNext}
              </Link>
            )}
          </div>
        </section>
        <details className="reception-lookup" open={Boolean(p.session)}>
          <summary>{d.findSession}</summary>{' '}
          <form action="/intake/reception">
            <div className="field">
              <label htmlFor="reception-id">{d.sessionId}</label>
              <input
                id="reception-id"
                name="session"
                defaultValue={typeof p.session === 'string' ? p.session : ''}
              />
            </div>
            <button className="btn btn-secondary">{d.findSession}</button>
          </form>
          {exact?.success ? (
            <Link
              href={`/intake/reception/${exact.data}`}
              className="text-link"
            >
              {d.open}
            </Link>
          ) : p.session ? (
            <p role="alert">{d.invalid}</p>
          ) : null}
        </details>
      </div>
    </>
  )
}
