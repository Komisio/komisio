import { z } from 'zod'
import {
  NavigationLink as Link,
  NavigationWarningProvider,
} from '@/components/platform/navigation-warning'
import { SellerHeader } from '@/components/seller/header'
import { notFound, redirect } from 'next/navigation'
import { renderPlatformContext } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readMySellerAccounts } from '@/lib/engine/seller-portal'
import {
  readMySubmissionHistory,
  readSubmissionSettings,
} from '@/lib/engine/seller-submissions'
import { SubmissionSuccess } from '@/components/seller/submission-success'
import { SubmissionForm } from '@/components/seller/submission-form'
import { SubmissionPhotos } from '@/components/seller/submission-photos'
import { SubmissionEstimate } from '@/components/seller/submission-estimate'
import './submissions.css'

export default async function Submissions({
  searchParams,
}: {
  searchParams: Promise<{ seller?: string; previous?: string; page?: string }>
}) {
  if (process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED !== 'true') notFound()
  const ctx = await renderPlatformContext()
  if (!ctx) redirect('/login?next=%2Fseller')
  if (ctx.mfaRequired) redirect('/mfa?next=%2Fseller')
  const params = await searchParams
  if (
    params.previous !== undefined &&
    !z.uuid().safeParse(params.previous).success
  )
    notFound()
  const page = /^\d{1,6}$/.test(params.page ?? '')
    ? Math.max(1, Math.min(100000, Number(params.page)))
    : 1
  const account = (await readMySellerAccounts(ctx.client)).find(
    (a) => a.sellerId === params.seller,
  )
  if (!account) notFound()
  const settings = await readSubmissionSettings(
    ctx.client,
    account.tenantId,
    account.sellerId,
  )
  const d = dictionary(ctx.locale).submissions
  const history = await readMySubmissionHistory(ctx.client, {
    tenantId: account.tenantId,
    sellerId: account.sellerId,
    page,
    previousId: params.previous ?? null,
  })
  const rows = history.rows
  const previous = history.selected
  if (params.previous && !previous) notFound()
  const pages = Math.max(1, Math.ceil(history.total / 25))
  const href = (targetPage: number) =>
    `/seller/submissions?${new URLSearchParams({ seller: account.sellerId, ...(params.previous ? { previous: params.previous } : {}), ...(targetPage > 1 ? { page: String(targetPage) } : {}) })}`
  if (page > pages) redirect(href(pages))
  return (
    <NavigationWarningProvider>
      <main className="onboarding">
        <SellerHeader locale={ctx.locale} />
        <Link href={`/seller?seller=${account.sellerId}`}>
          {d.back} · {account.storeName}
        </Link>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        {settings.enabled && (
          <section className="card">
            {previous && <p>{previous.note}</p>}
            {previous?.has_correction ? (
              <SubmissionSuccess sellerId={account.sellerId} d={d} />
            ) : (
              <SubmissionForm
                key={previous?.id ?? 'new'}
                tenantId={account.tenantId}
                sellerId={account.sellerId}
                previousId={previous?.id}
                settings={settings}
                locale={ctx.locale}
                d={d}
                unsavedMessage={dictionary(ctx.locale).inspection.unsaved}
              />
            )}
          </section>
        )}
        {!rows.length && <p>{d.empty}</p>}
        {rows.map((row) => (
          <article className="card submission-record" key={row.id}>
            <strong>{row.decision ? d[row.decision] : d.pending}</strong>
            {row.seller_price && (
              <p>
                {row.pricing_mode === 'seller'
                  ? d.sellerPrice
                  : d.requestedPrice}
                : {row.seller_price} {row.price_currency}
                {row.price_approved ? ` · ${d.priceApproved}` : ''}
              </p>
            )}
            <p className="submission-description">{row.description}</p>
            <SubmissionPhotos photos={row.photos} label={d.photos} />
            {row.assistance_output && (
              <SubmissionEstimate
                pricing={row.pricing_mode}
                output={row.assistance_output.suggestion}
                currency={row.assistance_output.currency}
                locale={ctx.locale}
                d={d}
              />
            )}
            {row.note && <p>{row.note}</p>}
            {row.decision === 'more_information' && !row.has_correction && (
              <Link
                className="btn btn-secondary"
                href={`/seller/submissions?seller=${account.sellerId}&previous=${row.id}&page=${page}`}
              >
                {d.complement}
              </Link>
            )}
          </article>
        ))}
        {pages > 1 && (
          <nav className="row wrap" aria-label={d.title}>
            {page > 1 && (
              <Link className="btn btn-secondary" href={href(page - 1)}>
                {d.previous}
              </Link>
            )}
            <span>
              {page} / {pages}
            </span>
            {page < pages && (
              <Link className="btn btn-secondary" href={href(page + 1)}>
                {d.next}
              </Link>
            )}
          </nav>
        )}
      </main>
    </NavigationWarningProvider>
  )
}
