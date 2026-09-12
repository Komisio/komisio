import { readStorePolicy } from '@/lib/engine/store-policy'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import type {
  Seller,
  BagReceipt,
  SellerAgreement,
  AgreementEvidence,
} from '@/lib/engine/intake'
import { ReceivingPanel } from '@/components/intake/receiving-panel'
import {
  bagQueueNavigation,
  bagQueueHref,
  readBagQueue,
} from '@/lib/engine/bag-queue'
import { EvidenceRecorder } from '@/components/intake/agreement-forms'

export default async function Intake({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  const policy = await readStorePolicy(ctx.client, active.id)
  const all = dictionary(ctx.locale)
  const d = all.intake
  const a = all.agreements
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const navigation = bagQueueNavigation.safeParse(params)
  if (!navigation.success) notFound()
  const filters = navigation.data
  const selectedId = z.uuid().safeParse(filters.seller)
  const [sellers, bags, selected, agreementResult] = await Promise.all([
    ctx.client
      .from('sellers')
      .select('id,name,email,phone')
      .eq('tenant_id', active.id)
      .ilike('name', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
      .order('name')
      .order('id')
      .limit(50),
    readBagQueue(ctx.client, active.id, params),
    selectedId.success
      ? ctx.client
          .from('sellers')
          .select('id,name,email,phone')
          .eq('tenant_id', active.id)
          .eq('id', selectedId.data)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ctx.client
      .from('seller_agreement_versions')
      .select('*')
      .eq('tenant_id', active.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (sellers.error || selected.error || agreementResult.error)
    throw new Error('Unable to load intake')
  const agreement = agreementResult.data as SellerAgreement | null
  const evidenceResult =
    agreement && selected.data
      ? await ctx.client
          .from('seller_agreement_evidence')
          .select('id,agreement_id,reference,recorded_at')
          .eq('tenant_id', active.id)
          .eq('agreement_id', agreement.id)
          .eq('seller_id', selected.data.id)
          .order('recorded_at', { ascending: false })
          .order('id')
          .limit(1)
          .maybeSingle()
      : { data: null, error: null }
  if (evidenceResult.error) throw new Error('Unable to load agreement evidence')
  const evidence = evidenceResult.data as AgreementEvidence | null
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <p>
          <Link className="text-link" href="/intake/reception">
            {all.reception.title}
          </Link>
          {' · '}
          <Link className="text-link" href="/intake/operations">
            {all.operations.title}
          </Link>
          {' · '}
          <Link className="text-link" href="/intake/purchases">
            {all.purchases.title}
          </Link>
        </p>
        <Link className="text-link" href="/intake/agreements">
          {a.manage}
        </Link>
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
        <div>
          {selected.data && agreement && (
            <section className="card intake-form agreement-at-intake">
              <h2>{a.evidenceHeading}</h2>
              <p>
                <strong>
                  {agreement.title} · {a.version} {agreement.version}
                </strong>
                <br />
                {a.language}:{' '}
                {agreement.language === 'sv' ? 'Svenska' : 'English'}
              </p>
              <p>
                {agreement.required_before_receipt ? a.required : a.optional}
              </p>
              <details>
                <summary>{a.view}</summary>
                <div className="agreement-text">{agreement.body}</div>
              </details>
              <p>{evidence ? a.available : a.missing}</p>
              {evidence ? (
                <p>
                  {a.staffRecorded}:{' '}
                  {new Date(evidence.recorded_at).toLocaleString(
                    ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                    { timeZone: 'Europe/Stockholm' },
                  )}
                  <br />
                  {evidence.reference}
                </p>
              ) : (
                active.role !== 'readonly' && (
                  <EvidenceRecorder
                    key={`${active.id}:${selected.data.id}:${agreement.id}`}
                    tenantId={active.id}
                    sellerId={selected.data.id}
                    agreementId={agreement.id}
                    d={all}
                  />
                )
              )}
            </section>
          )}
          {active.role !== 'readonly' ? (
            <ReceivingPanel
              key={`${active.id}:${selected.data?.id ?? 'new'}`}
              tenantId={active.id}
              seller={selected.data as Seller | null}
              d={d}
              expectedAgreementId={agreement?.id ?? null}
              agreementBlocked={Boolean(
                selected.data &&
                (agreement?.required_before_receipt ||
                  policy.policy.agreementRequiredFor.includes('bag_receipt')) &&
                !evidence,
              )}
            />
          ) : (
            <p>{d.readOnly}</p>
          )}
        </div>
      </div>
      <section className="card intake-form" id="bag-queue">
        <h2>{d.queue}</h2>
        <p>{d.queueHint}</p>
        <p>
          {selected.data ? d.bagsFor + ': ' + selected.data.name : d.allSellers}
        </p>
        <form action="/intake#bag-queue" className="field">
          {filters.seller && (
            <input type="hidden" name="seller" value={filters.seller} />
          )}
          <label htmlFor="bag-search">{d.bagSearch}</label>
          <div className="row">
            <input
              id="bag-search"
              name="bag"
              defaultValue={filters.bag || ''}
              maxLength={20}
              placeholder="K-123"
              pattern="[ ]*([Kk][ ]*-[ ]*)?[1-9][0-9]*[ ]*|"
            />
            <button className="btn btn-secondary">{d.findBag}</button>
          </div>
        </form>
        <div className="row">
          <Link
            className="text-link"
            href={bagQueueHref({ seller: filters.seller })}
          >
            {d.clearBagSearch}
          </Link>
          {filters.seller && (
            <Link className="text-link" href={bagQueueHref({})}>
              {d.showAllBags}
            </Link>
          )}
        </div>
        <ul className="intake-list">
          {bags.items.map((row) => {
            const bag = row as unknown as BagReceipt & {
              sellers: { name: string } | null
            }
            return (
              <li key={bag.id} className="intake-bag">
                <Link
                  className="text-link"
                  href={`/intake/bags/${bag.id}/inspect`}
                >
                  {dictionary(ctx.locale).inspection.title}
                </Link>
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
        {!bags.items.length && <p>{d.noMatchingBags}</p>}
        <nav className="row" aria-label={d.bagPages}>
          {bags.hasNewer && bags.items[0] && (
            <Link
              className="text-link"
              href={bagQueueHref({
                seller: filters.seller,
                bag: filters.bag,
                newer: bags.items[0].reference,
              })}
            >
              {d.newerBags}
            </Link>
          )}
          {bags.hasOlder && bags.items.at(-1) && (
            <Link
              className="text-link"
              href={bagQueueHref({
                seller: filters.seller,
                bag: filters.bag,
                older: bags.items.at(-1)!.reference,
              })}
            >
              {d.olderBags}
            </Link>
          )}
          {(filters.older || filters.newer) && (
            <Link
              className="text-link"
              href={bagQueueHref({ seller: filters.seller, bag: filters.bag })}
            >
              {d.firstBags}
            </Link>
          )}
        </nav>
      </section>
    </>
  )
}
