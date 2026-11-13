import Image from 'next/image'
import { ChevronDown, FileText, Images } from 'lucide-react'
import type { Dictionary } from '@/lib/i18n'
import type { ExternalRequestRow } from '@/lib/engine/external-item-offers'
import { externalOfferAmount } from '@/lib/platform/external-offer-amount'
import { EventTime } from '@/components/ui/event-time'
import { ExternalRequestReview } from './external-request-review'
import { ExternalItemRegistration } from './external-item-registration'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import styles from './external-request-queue.module.css'

type Agreement = { id: string; version: number; title: string; body: string }
const photoUrl = (request: string, photo: string) =>
  `/api/intake/requests/photos?${new URLSearchParams({ request, photo })}`

export function ExternalRequestQueue({
  rows,
  agreements,
  tenantId,
  write,
  locale,
  d,
  leaveWarning,
}: {
  rows: ExternalRequestRow[]
  agreements: Agreement[]
  tenantId: string
  write: boolean
  locale: string
  d: Dictionary['externalOffers']
  leaveWarning: string
}) {
  const t = d.queue
  return (
    <div className={styles.list}>
      {rows.map((row) => {
        const reviewable =
          !row.declined && (!row.offer || row.offer.status === 'expired')
        const agreement = agreements.find(
          (a) => a.id === row.agreement_version_id,
        )
        return (
          <details
            className={styles.request}
            key={`${row.id}:${row.offer?.id ?? ''}:${row.offer?.status ?? ''}:${row.declined}:${row.agreement_version_id}:${row.queue_status}`}
          >
            <summary className={styles.summary}>
              <span className={styles.thumbnail}>
                <Image
                  src={photoUrl(row.id, row.photos[0])}
                  alt=""
                  width={72}
                  height={80}
                  unoptimized
                />
                {row.photos.length > 1 ? (
                  <span
                    className={styles.photoCount}
                    aria-label={t.photosCount.replace(
                      '{count}',
                      String(row.photos.length),
                    )}
                  >
                    <Images size={12} aria-hidden="true" />
                    {row.photos.length}
                  </span>
                ) : null}
              </span>
              <span className={styles.item}>
                <span className={styles.itemName}>{row.description}</span>
                <span className={styles.meta}>
                  {[row.brand, d.conditions[row.condition]]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className={styles.date}>
                  <EventTime value={row.created_at} locale={locale} />
                </span>
              </span>
              <span className={styles.wish}>
                <span className={styles.caption}>{t.desiredAmount}</span>
                {row.desired_price_ore ? (
                  <strong>{externalOfferAmount(row.desired_price_ore)}</strong>
                ) : (
                  <span className={styles.noAmount}>{t.noDesiredAmount}</span>
                )}
              </span>
              <span className={styles.progress}>
                <span className={styles.badge} data-status={row.queue_status}>
                  {t.statuses[row.queue_status]}
                </span>
                {row.offer ? (
                  <span className={styles.offerAmount}>
                    {t.offeredAmount}:{' '}
                    <strong>
                      {externalOfferAmount(row.offer.sellerAmountOre)}
                    </strong>
                  </span>
                ) : null}
              </span>
              <span className={styles.disclosure}>
                <span>{reviewable && write ? t.review : t.details}</span>
                <ChevronDown size={18} aria-hidden="true" />
              </span>
            </summary>
            <div className={styles.detail}>
              <section className={styles.evidence} aria-label={t.itemDetails}>
                <h2>{t.itemDetails}</h2>
                <div className={styles.photos} aria-label={d.photos}>
                  {row.photos.map((photo, index) => (
                    <a
                      key={photo}
                      href={photoUrl(row.id, photo)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Image
                        src={photoUrl(row.id, photo)}
                        alt={`${row.description} · ${d.photos} ${index + 1}`}
                        width={160}
                        height={160}
                        unoptimized
                      />
                    </a>
                  ))}
                </div>
                {row.notes ? <p className={styles.notes}>{row.notes}</p> : null}
                {row.decline_note ? (
                  <p className={styles.notes}>{row.decline_note}</p>
                ) : null}
                {agreement ? (
                  <details className={styles.agreement}>
                    <summary>
                      <FileText size={15} aria-hidden="true" />
                      {d.agreement} · {agreement.version}
                    </summary>
                    <h3>{agreement.title}</h3>
                    <p className={styles.notes}>{agreement.body}</p>
                  </details>
                ) : null}
              </section>
              <section
                className={styles.action}
                aria-label={reviewable ? t.offerHeading : t.details}
              >
                {write && reviewable ? (
                  <>
                    <h2>{t.offerHeading}</h2>
                    <ExternalRequestReview
                      tenantId={tenantId}
                      requestId={row.id}
                      previousOfferId={row.offer?.id ?? null}
                      agreementId={row.agreement_version_id}
                      d={d}
                      leaveWarning={leaveWarning}
                    />
                  </>
                ) : null}
                {row.offer ? (
                  <div className={styles.offerDetails}>
                    <dl>
                      <div>
                        <dt>{t.offeredAmount}</dt>
                        <dd>
                          {externalOfferAmount(row.offer.sellerAmountOre)}
                        </dd>
                      </div>
                      <div>
                        <dt>{t.salePrice}</dt>
                        <dd>
                          {externalOfferAmount(row.offer.expectedSalePriceOre)}
                        </dd>
                      </div>
                    </dl>
                    {row.offer.status === 'offered' ||
                    row.offer.status === 'expired' ? (
                      <p className={styles.meta}>
                        {d.deadline}:{' '}
                        <EventTime
                          value={row.offer.expiresAt}
                          locale={locale}
                        />
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {row.offer?.guarantee?.itemId ? (
                  <Link
                    className="btn btn-secondary"
                    href={`/intake/items/${row.offer.guarantee.itemId}`}
                  >
                    {d.openItem}
                  </Link>
                ) : null}
                {row.offer?.handover ? (
                  <div className={styles.handover}>
                    <Link
                      href={`/intake/handovers?focus=${row.offer.handover.id}`}
                    >
                      {d.openHandover} · {row.offer.handover.reference}
                    </Link>
                    {row.offer.handover.itemCount > 1 ? (
                      <span className={styles.meta}>
                        {d.groupedItems.replace(
                          '{count}',
                          String(row.offer.handover.itemCount),
                        )}
                      </span>
                    ) : null}
                    {row.offer.handover.receivedAt ? (
                      <span className={styles.meta}>
                        {d.receivedAt}:{' '}
                        <EventTime
                          value={row.offer.handover.receivedAt}
                          locale={locale}
                        />
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {write &&
                row.offer?.guarantee &&
                !row.offer.guarantee.itemId ? (
                  <ExternalItemRegistration
                    tenantId={tenantId}
                    guaranteeId={row.offer.guarantee.id}
                    description={row.description}
                    priceOre={row.offer.expectedSalePriceOre}
                    d={d}
                    leaveWarning={leaveWarning}
                  />
                ) : null}
              </section>
            </div>
          </details>
        )
      })}
    </div>
  )
}
