import Image from 'next/image'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { centralOfferQueueVisible } from '@/lib/platform/central-offer-queue'
import { dictionary } from '@/lib/i18n'
import { readExternalOfferQueue } from '@/lib/engine/external-item-offers'
import { externalOfferAmount } from '@/lib/platform/external-offer-amount'
import { EventTime } from '@/components/ui/event-time'
import { ExternalRequestReview } from '@/components/intake/external-request-review'
import { ExternalItemRegistration } from '@/components/intake/external-item-registration'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import '@/app/seller/submissions/submissions.css'

export default async function ExternalRequests({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const ctx = await requirePlatform(),
    tenant = ctx.active!
  if (!(await centralOfferQueueVisible(ctx.client, tenant.id))) notFound()
  const all = dictionary(ctx.locale),
    d = all.externalOffers
  const params = await searchParams
  const page =
    params.page && /^[1-9]\d{0,3}$/.test(params.page)
      ? Math.min(4001, Number(params.page))
      : 1
  const { rows, total } = await readExternalOfferQueue(
    ctx.client,
    tenant.id,
    page,
  )
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.agreement_version_id ? [row.agreement_version_id] : [],
      ),
    ),
  ]
  const agreements = ids.length
    ? await ctx.client
        .from('seller_agreement_versions')
        .select('id,version,title,body')
        .eq('tenant_id', tenant.id)
        .in('id', ids)
    : { data: [], error: null }
  if (agreements.error) throw new Error('REQUEST_FAILED')
  const pages = Math.max(1, Math.ceil(total / 25))
  if (page > pages) redirect(`/intake/requests?page=${pages}`)
  return (
    <>
      <h1>{d.title}</h1>
      <p>{d.intro}</p>
      {!rows.length ? <p>{d.empty}</p> : null}
      {rows.map((row) => (
        <article
          className="card submission-record"
          key={`${row.id}:${row.offer?.id ?? ''}:${row.offer?.status ?? ''}:${row.declined}:${row.agreement_version_id}`}
        >
          <h2>
            {row.description}
            {row.brand ? ` · ${row.brand}` : ''}
          </h2>
          <EventTime value={row.created_at} locale={ctx.locale} />
          <p>
            {d.condition}: {d.conditions[row.condition]}
          </p>
          <div className="row wrap" aria-label={d.photos}>
            {row.photos.map((photo, index) => {
              const url = `/api/intake/requests/photos?${new URLSearchParams({ request: row.id, photo })}`
              return (
                <a key={photo} href={url} target="_blank" rel="noreferrer">
                  <Image
                    src={url}
                    alt={`${d.photos} ${index + 1}`}
                    width={112}
                    height={112}
                    unoptimized
                    style={{ objectFit: 'cover', borderRadius: 12 }}
                  />
                </a>
              )
            })}
          </div>
          {row.notes ? (
            <p className="submission-description">{row.notes}</p>
          ) : null}
          {row.desired_price_ore ? (
            <p>
              {d.desiredPrice}: {externalOfferAmount(row.desired_price_ore)}
            </p>
          ) : null}
          <strong>
            {row.declined
              ? d.declined
              : row.offer?.guarantee?.itemId
                ? d.registered
                : row.offer?.handover
                  ? d.handoverStatuses[row.offer.handover.status]
                  : row.offer
                    ? d[row.offer.status]
                    : d.waiting}
          </strong>
          {row.decline_note ? <p>{row.decline_note}</p> : null}
          {row.offer?.guarantee?.itemId ? (
            <p>
              <Link href={`/intake/items/${row.offer.guarantee.itemId}`}>
                {d.openItem}
              </Link>
            </p>
          ) : null}
          {row.offer?.handover ? (
            <div className="stack">
              <Link href={`/intake/handovers?focus=${row.offer.handover.id}`}>
                {d.openHandover} · {row.offer.handover.reference}
              </Link>
              <span>
                {d.groupedItems.replace(
                  '{count}',
                  String(row.offer.handover.itemCount),
                )}
              </span>
              {row.offer.handover.receivedAt ? (
                <span>
                  {d.receivedAt}:{' '}
                  <EventTime
                    value={row.offer.handover.receivedAt}
                    locale={ctx.locale}
                  />
                </span>
              ) : null}
            </div>
          ) : null}
          {row.offer ? (
            <>
              <p>
                {d.sellerAmount}:{' '}
                <strong>
                  {externalOfferAmount(row.offer.sellerAmountOre)}
                </strong>
              </p>
              {row.offer.status === 'offered' ||
              row.offer.status === 'expired' ? (
                <p>
                  {d.deadline}:{' '}
                  <EventTime value={row.offer.expiresAt} locale={ctx.locale} />
                </p>
              ) : null}
            </>
          ) : null}
          {agreements.data
            ?.filter((a) => a.id === row.agreement_version_id)
            .map((a) => (
              <details key={a.id}>
                <summary>
                  {d.agreement} · {a.version}
                </summary>
                <h3>{a.title}</h3>
                <p className="submission-description">{a.body}</p>
              </details>
            ))}
          {tenant.role !== 'readonly' &&
          row.offer?.guarantee &&
          !row.offer.guarantee.itemId ? (
            <ExternalItemRegistration
              tenantId={tenant.id}
              guaranteeId={row.offer.guarantee.id}
              description={row.description}
              priceOre={row.offer.expectedSalePriceOre}
              d={d}
              leaveWarning={all.leaveUnsaved}
            />
          ) : null}
          {tenant.role !== 'readonly' &&
          !row.declined &&
          (!row.offer || row.offer.status === 'expired') ? (
            <ExternalRequestReview
              tenantId={tenant.id}
              requestId={row.id}
              previousOfferId={row.offer?.id ?? null}
              agreementId={row.agreement_version_id}
              d={d}
              leaveWarning={all.leaveUnsaved}
            />
          ) : null}
        </article>
      ))}
      <nav className="row" aria-label={d.title}>
        {page > 1 ? (
          <Link href={`/intake/requests?page=${page - 1}`}>{d.previous}</Link>
        ) : null}
        {page < pages ? (
          <Link href={`/intake/requests?page=${page + 1}`}>{d.next}</Link>
        ) : null}
      </nav>
    </>
  )
}
