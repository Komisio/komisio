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
import { EvidenceRecorder } from '@/components/intake/agreement-forms'

export default async function Intake({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; seller?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  const all = dictionary(ctx.locale)
  const d = all.intake
  const a = all.agreements
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const selectedId = z.uuid().safeParse(params.seller)
  const [sellers, bags, selected, agreementResult] = await Promise.all([
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
    ctx.client
      .from('seller_agreement_versions')
      .select('*')
      .eq('tenant_id', active.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (sellers.error || bags.error || selected.error || agreementResult.error)
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
                agreement?.required_before_receipt &&
                !evidence,
              )}
            />
          ) : (
            <p>{d.readOnly}</p>
          )}
        </div>
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
        {!bags.data?.length && <p>{d.empty}</p>}
      </section>
    </>
  )
}
