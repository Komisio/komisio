import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readSubmissionQueue } from '@/lib/engine/seller-submissions'
import { SubmissionReview } from '@/components/intake/submission-review'
import { SubmissionPhotos } from '@/components/seller/submission-photos'
import { SubmissionEstimate } from '@/components/seller/submission-estimate'
import '@/app/seller/submissions/submissions.css'

export default async function Submissions({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  if (process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    d = dictionary(ctx.locale).submissions
  const params = await searchParams
  const page =
    params.page && /^[1-9]\d{0,4}$/.test(params.page) ? Number(params.page) : 1
  const { rows, total } = await readSubmissionQueue(ctx.client, active.id, page)
  const pages = Math.max(1, Math.ceil(total / 25))
  if (page > pages) redirect(`/intake/submissions?page=${pages}`)
  return (
    <>
      <Link href="/intake">{d.back}</Link>
      <h1>{d.queue}</h1>
      {!rows.length && <p>{d.empty}</p>}
      {rows.map((row) => {
        const review = row.seller_submission_reviews[0]
        return (
          <article key={row.id} className="card submission-record">
            <h2>{row.sellers?.name}</h2>
            <p className="submission-description">{row.description}</p>
            <SubmissionPhotos photos={row.photos} label={d.photos} />
            {row.assistance_output && (
              <SubmissionEstimate
                output={row.assistance_output.suggestion}
                currency={row.assistance_output.currency}
                d={d}
              />
            )}
            {review ? (
              <>
                <strong>{d[review.decision]}</strong>
                <p>{review.note}</p>
              </>
            ) : active.role !== 'readonly' ? (
              <SubmissionReview
                tenantId={active.id}
                submissionId={row.id}
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
          <Link
            className="btn btn-secondary"
            href={`/intake/submissions?page=${page - 1}`}
          >
            {d.previous}
          </Link>
        )}
        {page < pages && (
          <Link
            className="btn btn-secondary"
            href={`/intake/submissions?page=${page + 1}`}
          >
            {d.next}
          </Link>
        )}
      </nav>
    </>
  )
}
