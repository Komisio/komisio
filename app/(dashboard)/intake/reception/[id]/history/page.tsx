import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readReceptionHistory } from '@/lib/engine/reception-history'

const query = z.object({
  beforeSource: z.coerce.number().int().min(1).max(2147483647).optional(),
  beforeReview: z.coerce.number().int().min(1).max(2147483647).optional(),
})
export default async function History({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.uuid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform(),
    tenant = ctx.active!,
    currency = await readStoreCurrency(ctx.client, tenant.id),
    all = dictionary(ctx.locale),
    d = all.reception,
    h = d.history,
    page = query.safeParse(await searchParams)
  if (!page.success) return <p role="alert">{d.invalid}</p>
  const history = await readReceptionHistory(ctx.client, tenant.id, {
    sessionId: id.data,
    ...page.data,
  })
  const root = `/intake/reception/${id.data}`
  const time = (value: string) =>
    new Date(value).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  const older = (key: 'beforeSource' | 'beforeReview', value: number) =>
    `${root}/history?${new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(page.data).map(([k, v]) => [k, String(v)]),
      ),
      [key]: String(value),
    })}`
  return (
    <>
      <Link className="text-link" href={root}>
        {d.open}
      </Link>
      <div className="page-heading">
        <h1>{h.title}</h1>
        <p>{h.notice}</p>
      </div>
      <section
        className="card intake-form reception-history"
        aria-labelledby="history-reviews"
      >
        <h2 id="history-reviews">{h.reviews}</h2>
        {history.reviews.length === 0 && <p>{h.empty}</p>}
        {history.reviews.map((review) => (
          <article key={review.version}>
            <h3>
              {d.version} {review.version}
            </h3>
            <time dateTime={review.createdAt} title={review.createdAt}>
              {time(review.createdAt)}
            </time>
            <p>{review.description}</p>
            <dl className="reception-history-facts">
              <div>
                <dt>{d.price}</dt>
                <dd>
                  {review.price === null ? '—' : `${review.price} ${currency}`}
                </dd>
              </div>
              <div>
                <dt>{h.sourceRevision}</dt>
                <dd>{review.sourceRevision}</dd>
              </div>
              <div>
                <dt>{d.sharedPhotos}</dt>
                <dd>{review.photoCount}</dd>
              </div>
            </dl>
            <p className="reception-history-response">
              {review.response
                ? review.response.decision === 'approve'
                  ? h.approved
                  : h.declined
                : h.unanswered}
            </p>
            {review.response && (
              <time
                dateTime={review.response.created_at}
                title={review.response.created_at}
              >
                {time(review.response.created_at)}
              </time>
            )}
          </article>
        ))}
        {history.nextReview !== null && (
          <Link
            className="text-link"
            href={older('beforeReview', history.nextReview)}
          >
            {h.olderReviews}
          </Link>
        )}
      </section>
      <section
        className="card intake-form reception-history"
        aria-labelledby="history-sources"
      >
        <h2 id="history-sources">{h.sources}</h2>
        {history.sources.length === 0 && <p>{h.empty}</p>}
        {history.sources.map((source) => (
          <article key={source.revision}>
            <h3>
              {h.sourceRevision} {source.revision}
            </h3>
            <time dateTime={source.savedAt} title={source.savedAt}>
              {time(source.savedAt)}
            </time>
            <ul>
              {source.evidence.map((evidence, index) => (
                <li key={index}>
                  {h.kinds[evidence.kind]}
                  {evidence.observation && `: ${evidence.observation}`}
                </li>
              ))}
            </ul>
          </article>
        ))}
        {history.nextSource !== null && (
          <Link
            className="text-link"
            href={older('beforeSource', history.nextSource)}
          >
            {h.olderSources}
          </Link>
        )}
      </section>
      <p>
        <Link className="text-link" href={`${root}/history`}>
          {h.latest}
        </Link>
      </p>
    </>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.reception.history.title)
