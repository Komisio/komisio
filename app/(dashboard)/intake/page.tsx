import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import type { Seller, BagReceipt } from '@/lib/engine/intake'
import { ReceivingPanel } from '@/components/intake/receiving-panel'

export default async function Intake({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; seller?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  const d = dictionary(ctx.locale).intake
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const selectedId = z.uuid().safeParse(params.seller)
  const [sellers, bags, selected] = await Promise.all([
    ctx.client
      .from('sellers')
      .select('id,name,email,phone')
      .eq('tenant_id', active.id)
      .ilike('name', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
      .order('name')
      .order('id')
      .limit(50),
    ctx.client
      .from('bag_receipts')
      .select('id,seller_id,reference,note,received_at,sellers(name)')
      .eq('tenant_id', active.id)
      .order('received_at', { ascending: false })
      .order('id')
      .limit(50),
    selectedId.success
      ? ctx.client
          .from('sellers')
          .select('id,name,email,phone')
          .eq('tenant_id', active.id)
          .eq('id', selectedId.data)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (sellers.error || bags.error || selected.error)
    throw new Error('Unable to load intake')
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
      </div>
      <p className="intake-notice">{d.pilot}</p>
      <div className="intake-grid">
        <section className="card intake-form">
          <h2>{d.find}</h2>
          <form action="/intake" className="field">
            <label htmlFor="seller-search">{d.search}</label>
            <div className="row">
              <input
                id="seller-search"
                name="q"
                defaultValue={q}
                maxLength={120}
              />
              <button className="btn btn-secondary">{d.searchButton}</button>
            </div>
          </form>
          <p>
            <Link className="text-link" href="/intake">
              {d.newSeller}
            </Link>
          </p>
          <ul className="intake-list">
            {(sellers.data as Seller[]).map((s) => (
              <li key={s.id}>
                <Link
                  href={`/intake?seller=${s.id}`}
                  className="intake-seller"
                  aria-current={selected.data?.id === s.id ? 'true' : undefined}
                >
                  <strong>{s.name}</strong>
                  <small>{s.email || s.phone}</small>
                  <span>{d.choose}</span>
                </Link>
              </li>
            ))}
          </ul>
          {!sellers.data?.length && <p>{d.noSellers}</p>}
          <small>{d.limit}</small>
        </section>
        {active.role !== 'readonly' ? (
          <ReceivingPanel
            key={`${active.id}:${selected.data?.id ?? 'new'}`}
            tenantId={active.id}
            seller={selected.data as Seller | null}
            d={d}
          />
        ) : (
          <p>{d.readOnly}</p>
        )}
      </div>
      <section className="card intake-form">
        <h2>{d.queue}</h2>
        <p>{d.queueHint}</p>
        <ul className="intake-list">
          {bags.data?.map((row) => {
            const bag = row as unknown as BagReceipt & {
              sellers: { name: string } | null
            }
            return (
              <li key={bag.id} className="intake-bag">
                <div>
                  <strong>
                    {d.bag} K-{bag.reference}
                  </strong>
                  <br />
                  {bag.sellers?.name}
                  <br />
                  <small>
                    {new Date(bag.received_at).toLocaleString(
                      ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                      { timeZone: 'Europe/Stockholm' },
                    )}{' '}
                    · {d.awaiting}
                  </small>
                </div>
                <Link
                  className="btn btn-secondary"
                  href={`/intake/bags/${bag.id}`}
                >
                  {d.label}
                </Link>
              </li>
            )
          })}
        </ul>
        {!bags.data?.length && <p>{d.empty}</p>}
      </section>
    </>
  )
}
