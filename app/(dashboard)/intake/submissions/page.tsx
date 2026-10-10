import { SubmissionReception } from '@/components/intake/submission-reception'
import { SubmissionNotification } from '@/components/intake/submission-notification'
import { factCommunicationId } from '@/lib/communications/dispatch'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readSubmissionQueue,
  submissionQueueFilter,
} from '@/lib/engine/seller-submissions'
import { EventTime } from '@/components/ui/event-time'
import { SubmissionQueueSearch } from '@/components/intake/submission-queue-search'
import { SubmissionReview } from '@/components/intake/submission-review'
import { SubmissionPhotos } from '@/components/seller/submission-photos'
import { SubmissionEstimate } from '@/components/seller/submission-estimate'
import '@/app/seller/submissions/submissions.css'

export default async function Submissions({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; view?: string; q?: string }>
}) {
  if (process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    d = dictionary(ctx.locale).submissions
  const params = await searchParams
  const page =
    params.page && /^[1-9]\d{0,4}$/.test(params.page) ? Number(params.page) : 1
  const view = submissionQueueFilter.safeParse(params.view).data ?? 'all'
  const query =
    typeof params.q === 'string' ? params.q.trim().slice(0, 100) : ''
  const href = (filter = view, target = 1) =>
    `/intake/submissions?${new URLSearchParams({ view: filter, q: query, page: String(target) })}`
  const { rows, total } = await readSubmissionQueue(
    ctx.client,
    active.id,
    page,
    view,
    query,
  )
  const sessionIds = rows.flatMap((r) =>
    r.submission_receptions.map((s) => s.session_id),
  )
  const notificationIds = rows.flatMap((r) =>
    r.seller_submission_reviews.map((v) =>
      factCommunicationId('submission_review', v.id),
    ),
  )
  const drafts = sessionIds.length
    ? await ctx.client
        .from('reception_sources_current')
        .select('session_id')
        .eq('tenant_id', active.id)
        .in('session_id', sessionIds)
    : { data: [], error: null }
  const notices = notificationIds.length
    ? await ctx.client
        .from('seller_communications')
        .select('id,status')
        .eq('tenant_id', active.id)
        .in('id', notificationIds)
    : { data: [], error: null }
  if (drafts.error || notices.error) throw new Error('REQUEST_FAILED')
  const pages = Math.max(1, Math.ceil(total / 25))
  if (page > pages) redirect(href(view, pages))
  return (
    <>
      <Link href="/intake">{d.back}</Link>
      <h1>{d.queue}</h1>
      <SubmissionQueueSearch
        key={`${view}:${query}`}
        view={view}
        query={query}
        d={d}
      />
      <nav className="row wrap" aria-label={d.queueView}>
        {submissionQueueFilter.options.map((filter) => (
          <Link
            key={filter}
            className="text-link"
            href={href(filter)}
            aria-current={filter === view ? 'page' : undefined}
          >
            {d.queueFilters[filter]}
          </Link>
        ))}
      </nav>
      {['owner', 'admin'].includes(active.role) && (
        <Link className="text-link" href="/intake/pricing">
          {dictionary(ctx.locale).pricingFollowUp.title}
        </Link>
      )}
      {!rows.length && <p>{d.empty}</p>}
      {rows.map((row) => {
        const review = row.seller_submission_reviews[0]
        return (
          <article
            key={`${row.id}:${view}:${query}`}
            className="card submission-record"
          >
            <h2>{row.sellers?.name}</h2>
            <small>
              <EventTime value={row.created_at} locale={ctx.locale} />
            </small>
            {row.seller_price !== null && (
              <p>
                {row.pricing_mode === 'seller'
                  ? d.sellerPrice
                  : d.requestedPrice}
                : {row.seller_price} {row.price_currency}
                {review?.price_approved ? ` · ${d.priceApproved}` : ''}
              </p>
            )}
            <p className="submission-description">{row.description}</p>
            <SubmissionPhotos photos={row.photos} label={d.photos} />
            {row.assistance_output && (
              <SubmissionEstimate
                staff
                pricing={row.pricing_mode}
                output={row.assistance_output.suggestion}
                currency={row.assistance_output.currency}
                locale={ctx.locale}
                d={d}
              />
            )}
            {review ? (
              <>
                <strong>{d[review.decision]}</strong>
                <p>{review.note}</p>
                {active.role !== 'readonly' && (
                  <SubmissionNotification
                    tenantId={active.id}
                    reviewId={review.id}
                    status={
                      notices.data?.find(
                        (n) =>
                          n.id ===
                          factCommunicationId('submission_review', review.id),
                      )?.status ?? null
                    }
                    d={d}
                  />
                )}
                {row.item_id ? (
                  <Link
                    className="btn btn-secondary"
                    href={`/intake/items/${row.item_id}`}
                  >
                    {d.queueViewItem}
                  </Link>
                ) : (
                  review.decision === 'invite' &&
                  active.role !== 'readonly' &&
                  (drafts.data?.some(
                    (s) =>
                      s.session_id === row.submission_receptions[0]?.session_id,
                  ) ? (
                    <Link
                      className="btn btn-primary"
                      href={`/intake/reception/${row.submission_receptions[0].session_id}`}
                    >
                      {d.continueReception}
                    </Link>
                  ) : (
                    <SubmissionReception
                      leaveWarning={dictionary(ctx.locale).leaveUnsaved}
                      tenantId={active.id}
                      submissionId={row.id}
                      description={row.description}
                      price={
                        row.seller_price === null
                          ? (row.assistance_output?.suggestion
                              .indicativePrice ?? '')
                          : String(row.seller_price)
                      }
                      d={d}
                    />
                  ))
                )}
              </>
            ) : active.role !== 'readonly' ? (
              <SubmissionReview
                leaveWarning={dictionary(ctx.locale).leaveUnsaved}
                tenantId={active.id}
                submissionId={row.id}
                pricing={row.pricing_mode}
                d={d}
              />
            ) : (
              <p>{d.pending}</p>
            )}
          </article>
        )
      })}
      <nav aria-label={d.queue}>
        {page > 1 && (
          <Link className="btn btn-secondary" href={href(view, page - 1)}>
            {d.previous}
          </Link>
        )}
        {page < pages && (
          <Link className="btn btn-secondary" href={href(view, page + 1)}>
            {d.next}
          </Link>
        )}
      </nav>
    </>
  )
}
