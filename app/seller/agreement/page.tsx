import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { renderPlatformContext as platformContext } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readMySellerAccounts } from '@/lib/engine/seller-portal'
import { readMySellerAgreement } from '@/lib/engine/seller-agreement'
import { AgreementAcceptance } from '@/components/seller/agreement-acceptance'
import { PrintLabel } from '@/components/intake/print-label'
import { EventTime } from '@/components/ui/event-time'

export const generateMetadata = () =>
  platformPageMetadata((d) => d.sellerAgreement.title, {
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  })
export default async function SellerAgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ seller?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await platformContext()
  if (!ctx) redirect('/login?next=%2Fseller')
  if (ctx.mfaRequired) redirect('/mfa?next=%2Fseller')
  const { seller } = await searchParams
  const account = (await readMySellerAccounts(ctx.client)).find(
    (a) => a.sellerId === seller,
  )
  if (!account) notFound()
  const d = dictionary(ctx.locale)
  const state = await readMySellerAgreement(
    ctx.client,
    account.tenantId,
    account.sellerId,
  )
  if (!state.agreement) notFound()
  const agreement = state.agreement
  return (
    <main className="onboarding seller-review" lang={intlLocale(ctx.locale)}>
      <div className="no-print">
        <Link href={`/seller?seller=${account.sellerId}`}>
          {d.submissions.back} · {account.storeName}
        </Link>
      </div>
      <article className="card">
        <p>{account.storeName}</p>
        <h1>{agreement.title}</h1>
        <p>
          {d.agreements.version} {agreement.version}
        </p>
        <div
          lang={intlLocale(agreement.language)}
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {agreement.body}
        </div>
        {state.acceptance ? (
          <p role="status">
            {state.acceptance.source === 'seller_portal'
              ? d.sellerAgreement.accepted
              : d.sellerAgreement.recorded}{' '}
            · <EventTime value={state.acceptance.at} locale={ctx.locale} />
          </p>
        ) : (
          <AgreementAcceptance
            key={agreement.id}
            tenantId={account.tenantId}
            sellerId={account.sellerId}
            agreementId={agreement.id}
            d={d}
          />
        )}
        <div className="no-print">
          <PrintLabel label={d.agreements.usage.print} />
        </div>
      </article>
    </main>
  )
}
