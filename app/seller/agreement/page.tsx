import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { renderPlatformContext as platformContext } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readMySellerAccounts } from '@/lib/engine/seller-portal'
import { readMySellerAgreementArchive } from '@/lib/engine/seller-agreement'
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
  searchParams: Promise<{ seller?: string; version?: string; page?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await platformContext()
  if (!ctx) redirect('/login?next=%2Fseller')
  if (ctx.mfaRequired) redirect('/mfa?next=%2Fseller')
  const { seller, version, page: pageParam } = await searchParams
  if (version !== undefined && !z.uuid().safeParse(version).success) notFound()
  const page = /^\d{1,6}$/.test(pageParam ?? '')
    ? Math.max(1, Math.min(100000, Number(pageParam)))
    : 1
  const account = (await readMySellerAccounts(ctx.client)).find(
    (a) => a.sellerId === seller,
  )
  if (!account) notFound()
  const d = dictionary(ctx.locale)
  const state = await readMySellerAgreementArchive(
    ctx.client,
    account.tenantId,
    account.sellerId,
    version ?? null,
    page,
  )
  if (!state.agreement) notFound()
  const agreement = state.agreement
  const href = (selected: string | null, targetPage = page) =>
    `/seller/agreement?${new URLSearchParams({ seller: account.sellerId, ...(selected ? { version: selected } : {}), ...(targetPage > 1 ? { page: String(targetPage) } : {}) })}`
  const pages = Math.max(1, Math.ceil(state.total / 20))
  if (page > pages) redirect(href(version ?? null, pages))
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
          {!state.current && <> · {d.sellerAgreement.previousVersion}</>}
        </p>
        {!state.current && (
          <p className="no-print">
            <Link href={href(null)}>{d.sellerAgreement.currentVersion}</Link>
          </p>
        )}
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
        ) : state.current ? (
          <AgreementAcceptance
            key={agreement.id}
            tenantId={account.tenantId}
            sellerId={account.sellerId}
            agreementId={agreement.id}
            d={d}
          />
        ) : null}
        <div className="no-print">
          <PrintLabel label={d.agreements.usage.print} />
        </div>
      </article>
      {state.total > 0 && (
        <details className="card no-print" open={page > 1}>
          <summary>{d.sellerAgreement.history}</summary>
          <ul>
            {state.history.map((entry) => (
              <li key={entry.id} style={{ paddingBlock: '0.5rem' }}>
                <Link
                  href={href(entry.id)}
                  aria-current={entry.id === agreement.id ? 'page' : undefined}
                >
                  {d.agreements.version} {entry.version} · {entry.title}
                </Link>
                <div className="muted">
                  <EventTime value={entry.at} locale={ctx.locale} />
                </div>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav className="row wrap" aria-label={d.sellerAgreement.history}>
              {page > 1 && (
                <Link href={href(version ?? null, page - 1)}>
                  {d.submissions.previous}
                </Link>
              )}
              <span>
                {page} / {pages}
              </span>
              {page < pages && (
                <Link href={href(version ?? null, page + 1)}>
                  {d.submissions.next}
                </Link>
              )}
            </nav>
          )}
        </details>
      )}
    </main>
  )
}
