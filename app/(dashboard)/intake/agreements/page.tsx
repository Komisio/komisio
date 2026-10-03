import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale, localeNames, resolveLocale } from '@/lib/i18n'
import type { SellerAgreement } from '@/lib/engine/intake'
import { AgreementPublisher } from '@/components/intake/agreement-forms'

export default async function Agreements({
  searchParams,
}: {
  searchParams: Promise<{ version?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    d = dictionary(ctx.locale),
    a = d.agreements
  const params = await searchParams
  const selectedId = params.version ? z.uuid().safeParse(params.version) : null
  if (selectedId && !selectedId.success) notFound()
  const [latest, history, requested] = await Promise.all([
    ctx.client
      .from('seller_agreement_versions')
      .select('*')
      .eq('tenant_id', active.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    ctx.client
      .from('seller_agreement_versions')
      .select('id,version,title')
      .eq('tenant_id', active.id)
      .order('version', { ascending: false })
      .limit(20),
    selectedId?.success
      ? ctx.client
          .from('seller_agreement_versions')
          .select('*')
          .eq('tenant_id', active.id)
          .eq('id', selectedId.data)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (latest.error || history.error || requested.error)
    throw new Error('Unable to load agreements')
  if (selectedId && !requested.data) notFound()
  const current = latest.data as SellerAgreement | null
  const shown = (requested.data ?? current) as SellerAgreement | null
  return (
    <>
      <div className="page-heading">
        <h1>{a.title}</h1>
        <p>{a.intro}</p>
      </div>
      <div className="agreements-workspace">
        <section className="card intake-form agreement-reader">
          {shown ? (
            <>
              <span className="badge">
                {shown.id === current?.id ? a.current : a.historical} ·{' '}
                {a.version} {shown.version}
              </span>
              <h2>{shown.title}</h2>
              {shown.id !== current?.id && (
                <Link className="text-link" href="/intake/agreements">
                  {a.current}
                </Link>
              )}
              <p>
                {a.language}:{' '}
                {localeNames[resolveLocale(undefined, shown.language)]}
              </p>
              <p>{shown.required_before_receipt ? a.required : a.optional}</p>
              <div className="agreement-text" lang={intlLocale(shown.language)}>
                {shown.body}
              </div>
            </>
          ) : (
            <p>{a.none}</p>
          )}
        </section>
        <details className="card agreement-history">
          <summary>{a.history}</summary>
          <p>{a.historyHint}</p>
          <ul className="intake-list">
            {history.data?.map((v) => (
              <li key={v.id}>
                <Link
                  className="text-link"
                  href={`/intake/agreements?version=${v.id}`}
                  aria-current={v.id === shown?.id ? 'page' : undefined}
                >
                  {a.version} {v.version} – {v.title}
                </Link>
              </li>
            ))}
          </ul>
        </details>
        {['owner', 'admin'].includes(active.role) ? (
          <AgreementPublisher
            key={active.id}
            tenantId={active.id}
            current={current}
            locale={ctx.locale}
            d={d}
          />
        ) : (
          <p>{a.adminOnly}</p>
        )}
      </div>
    </>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.agreements.title)
