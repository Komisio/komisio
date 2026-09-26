'use client'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, RefreshCw } from 'lucide-react'
import type { Dictionary } from '@/lib/i18n'
import type { FlowMetric, FlowSnapshot } from '@/lib/engine/store-flow-snapshot'
import { receptionStage } from '@/lib/engine/reception-queue'
import { itemStage } from '@/lib/engine/items'

export function StoreFlowNow({
  snapshot,
  announcedCount,
  d,
  stages,
  inventoryStages,
  locale,
}: {
  snapshot: FlowSnapshot | null
  announcedCount: number | null
  d: Dictionary['storeFlow']['live']
  stages: Dictionary['reception']['queueStages']
  inventoryStages: Dictionary['lifecycle']['stages']
  locale: string
}) {
  const [showEmpty, setShowEmpty] = useState(false)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Stockholm',
    }).format(new Date(value))
  function card(
    id: string,
    title: string,
    metric: FlowMetric | undefined,
    href: string,
    since: string,
    unit = d.items,
    help?: string,
  ) {
    const count = metric?.count ?? 0
    if (!count && !showEmpty && id !== 'dropoffs') return null
    const days =
      metric?.oldest && snapshot
        ? Math.max(
            0,
            Math.floor(
              (Date.parse(snapshot.asOf) - Date.parse(metric.oldest)) /
                86400000,
            ),
          )
        : 0
    return (
      <article className="flow-metric" data-flow-metric={id} key={id}>
        <h3>{title}</h3>
        <p className="flow-count">
          <strong>{new Intl.NumberFormat(locale).format(count)}</strong>{' '}
          {count === 1
            ? unit === d.deliveries
              ? d.deliveryOne
              : d.itemOne
            : unit}
        </p>
        {help && <p>{help}</p>}
        {metric?.oldest && (
          <p className="flow-age">
            {since}:{' '}
            <time dateTime={metric.oldest} title={date(metric.oldest)}>
              {days
                ? new Intl.RelativeTimeFormat(locale, {
                    numeric: 'always',
                  }).format(-days, 'day')
                : d.today}
            </time>
          </p>
        )}
        {!count && <p>{d.empty}</p>}
        <Link href={href}>
          {d.open}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </article>
    )
  }
  const sellerStages = [
    'awaiting_seller',
    'ready_to_share',
    'link_revoked',
    'expired',
    'declined',
  ] as const
  const registration = receptionStage.options.filter(
    (stage) =>
      stage !== 'accepted' &&
      !sellerStages.includes(stage as (typeof sellerStages)[number]),
  )
  return (
    <section className="flow-now" aria-label={d.now}>
      <div className="flow-now-heading">
        <div>
          <h2>{d.now}</h2>
          <p>{d.intro}</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {pending ? d.refreshing : d.refresh}
        </button>
      </div>
      {!snapshot ? (
        <p role="alert">{d.unavailable}</p>
      ) : (
        <>
          <p className="flow-asof">
            {d.updated}:{' '}
            <time dateTime={snapshot.asOf}>{date(snapshot.asOf)}</time>
          </p>
          <label className="flow-show-empty">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(event) => setShowEmpty(event.target.checked)}
            />
            {d.showEmpty}
          </label>
          <div className="flow-live-grid">
            <section className="flow-live-column">
              <h2>1 · {d.receiving}</h2>
              {announcedCount === null ? (
                <p role="status">{d.announcementsUnavailable}</p>
              ) : (
                card(
                  'announcements',
                  d.announcements,
                  { count: announcedCount, oldest: null },
                  '/intake/handovers?status=open',
                  d.received,
                  d.deliveries,
                  d.announcementsHelp,
                )
              )}
              {card(
                'dropoffs',
                d.dropoffs,
                snapshot.dropoffs,
                '/intake?state=unstarted#bag-queue',
                d.received,
                d.deliveries,
                d.dropoffHelp,
              )}
            </section>
            <section className="flow-live-column">
              <h2>2 · {d.registration}</h2>
              {card(
                'drafts',
                d.drafts,
                snapshot.drafts,
                '/intake?state=drafts#bag-queue',
                d.started,
                d.items,
                d.draftHelp,
              )}
              {!showEmpty &&
                !snapshot.drafts.count &&
                !registration.some(
                  (stage) => snapshot.reception[stage]?.count,
                ) && <p>{d.empty}</p>}
              {registration.map((stage) =>
                card(
                  stage,
                  stages[stage],
                  snapshot.reception[stage],
                  '/intake/reception?stage=' + stage,
                  d.started,
                ),
              )}
            </section>
            <section className="flow-live-column">
              <h2>3 · {d.seller}</h2>
              {!showEmpty &&
                !sellerStages.some(
                  (stage) => snapshot.reception[stage]?.count,
                ) && <p>{d.empty}</p>}
              {sellerStages.map((stage) =>
                card(
                  stage,
                  stages[stage],
                  snapshot.reception[stage],
                  '/intake/reception?stage=' + stage,
                  d.started,
                ),
              )}
            </section>
            <section className="flow-live-column">
              <h2>4 · {d.inventory}</h2>
              {!showEmpty &&
                !Object.values(snapshot.inventory).some(
                  (metric) => metric?.count,
                ) && <p>{d.empty}</p>}
              {itemStage.options.map((stage) =>
                card(
                  stage,
                  inventoryStages[stage],
                  snapshot.inventory[stage],
                  '/intake/items?stage=' + stage,
                  d.accepted,
                ),
              )}
            </section>
          </div>
          <p className="flow-explanation">{d.scope}</p>
        </>
      )}
    </section>
  )
}
