import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
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
        <p>{d.intro}</p>
      </div>
      <p className="intake-notice">{d.manual}</p>
      <div className="intake-grid">
        <section className="card intake-form">
          <h2>{d.start}</h2>
          <form action="/intake/reception">
            <div className="field">
              <label htmlFor="reception-search">{d.search}</label>
              <div className="row wrap">
                <input
                  id="reception-search"
                  name="q"
                  defaultValue={q}
                  maxLength={120}
                />
                <button className="btn btn-secondary">{d.searchButton}</button>
              </div>
            </div>
          </form>
          <p>{d.searchLimit}</p>
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
        </section>
        <section className="card intake-form">
          <h2>{d.queueTitle}</h2>
          <p>{d.queueHelp}</p>
          {!parsed.success && <p role="alert">{d.invalid}</p>}
          <form action="/intake/reception">
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
          <ul className="intake-list">
            {recent.items.map((r) => {
              return (
                <li key={r.session_id}>
                  <Link
                    className="intake-seller"
                    href={`/intake/reception/${r.session_id}`}
                  >
                    <strong>{r.seller_name}</strong>
                    <span>{d.queueStages[r.stage]}</span>
                    <small>{d.queueNextSteps[r.nextStep]}</small>
                    <small>
                      {new Date(r.created_at).toLocaleString(
                        ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                        { timeZone: 'Europe/Stockholm' },
                      )}
                    </small>
                    <span>{d.open}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {recent.items.length === 0 && <p>{d.queueEmpty}</p>}
          {recent.next && (
            <Link
              className="text-link"
              href={`/intake/reception?${new URLSearchParams({ q, stage: queueInput.stage ?? '', ...recent.next })}`}
            >
              {d.queueNext}
            </Link>
          )}
        </section>
      </div>
    </>
  )
}
