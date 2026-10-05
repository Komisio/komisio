import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { PrintLabel } from '@/components/intake/print-label'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale, localeNames, resolveLocale } from '@/lib/i18n'
import { readStorePolicy } from '@/lib/engine/store-policy'
import type { SellerAgreement } from '@/lib/engine/intake'
import { readAgreementDraft } from '@/lib/engine/agreement-assistance'
import { AgreementPublisher } from '@/components/intake/agreement-forms'

export default async function Agreements({
  searchParams,
}: {
  searchParams: Promise<{ version?: string; draft?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    d = dictionary(ctx.locale),
    a = d.agreements
  const params = await searchParams
  const selectedId = params.version ? z.uuid().safeParse(params.version) : null
  if (selectedId && !selectedId.success) notFound()
  if (params.draft && !z.uuid().safeParse(params.draft).success) notFound()
  const [latest, history, requested, policy] = await Promise.all([
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
    readStorePolicy(ctx.client, active.id),
  ])
  if (latest.error || history.error || requested.error)
    throw new Error('Unable to load agreements')
  if (selectedId && !requested.data) notFound()
  const current = latest.data as SellerAgreement | null
  const draft = ['owner', 'admin'].includes(active.role)
    ? await readAgreementDraft(
        ctx.client,
        active.id,
        ctx.user.id,
        current?.id ?? null,
        params.draft,
      )
    : null
  const shown = (requested.data ?? current) as SellerAgreement | null
  return (
    <div className="agreements-page">
      <div className="page-heading">
        <FormHelpHeading
          title={a.title}
          level={1}
          help={{
            label: a.usage.helpLabel,
            steps: [a.usage.prepare, a.usage.accept, a.usage.record],
          }}
        />
        <Link className="text-link" href="/intake/sellers">
          {a.usage.chooseSeller} →
        </Link>
      </div>
      <div className="agreements-workspace">
        <section className="card intake-form agreement-reader">
          {shown ? (
            <>
              <p className="agreement-print-store">{active.name}</p>
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
              {shown.id === current?.id && (
                <p className="no-print">
                  {shown.required_before_receipt ||
                  policy.policy.agreementRequiredFor.includes('bag_receipt')
                    ? a.required
                    : a.optional}
                </p>
              )}
              <div className="no-print agreement-print-actions">
                <PrintLabel label={a.usage.print} />
              </div>
              <div className="agreement-text" lang={intlLocale(shown.language)}>
                {shown.body}
              </div>
              <div className="agreement-signatures">
                {[
                  a.usage.sellerName,
                  a.usage.date,
                  a.usage.sellerSignature,
                  a.usage.storeSignature,
                ].map((label) => (
                  <div key={label}>
                    <span>{label}</span>
                    <div />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>{a.none}</p>
          )}
        </section>
        <details className="card agreement-history">
          <summary>{a.history}</summary>
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
            draft={draft}
            locale={ctx.locale}
            d={d}
          />
        ) : (
          <p>{a.adminOnly}</p>
        )}
      </div>
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.agreements.title)
