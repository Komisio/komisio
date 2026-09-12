import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
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
    new Date(value).toLocaleString(ctx.locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
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
      <section className="card intake-form">
        <h2>{h.reviews}</h2>
        {history.reviews.length === 0 && <p>{h.empty}</p>}
        {history.reviews.map((review) => (
          <article key={review.version}>
            <h3>
              {d.version} {review.version}
            </h3>
            <p>{time(review.createdAt)} (Europe/Stockholm)</p>
            <p>
              {h.sourceRevision}: {review.sourceRevision}
            </p>
            <p>{review.description}</p>
            <p>
              {d.price}: {review.price} SEK
            </p>
            <p>
              {d.sharedPhotos}: {review.photoCount}
            </p>
            <p>
              {review.response
                ? review.response.decision === 'approve'
                  ? h.approved
                  : h.declined
                : h.unanswered}
            </p>
            {review.response && (
              <p>{time(review.response.created_at)} (Europe/Stockholm)</p>
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
      <section className="card intake-form">
        <h2>{h.sources}</h2>
        {history.sources.length === 0 && <p>{h.empty}</p>}
        {history.sources.map((source) => (
          <article key={source.revision}>
            <h3>
              {h.sourceRevision} {source.revision}
            </h3>
            <p>{time(source.savedAt)} (Europe/Stockholm)</p>
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
