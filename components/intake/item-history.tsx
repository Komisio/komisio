import type { Dictionary, Locale } from '@/lib/i18n'
import { formatOre, type readItem } from '@/lib/engine/items'
import { ActorSignature } from './actor-signature'
import { EventTime } from '@/components/ui/event-time'
import { economyFormat } from '@/lib/intake/economy-format'
import { itemCollectionDetail } from '@/lib/engine/item-collection'
import { z } from 'zod'

type Detail = NonNullable<Awaited<ReturnType<typeof readItem>>>
export function ItemHistory({
  prices,
  events,
  currency,
  locale,
  d,
}: Pick<Detail, 'prices' | 'events'> & {
  currency: string
  locale: Locale
  d: Dictionary['items']
}) {
  return (
    <>
      <details className="card intake-form item-detail-section">
        <summary>
          {d.prices} <span>({prices.length})</span>
        </summary>
        <ul className="item-detail-history">
          {prices.map((p) => (
            <li key={p.id}>
              <div className="item-actor-line">
                <strong>
                  {formatOre(p.price_ore)} {currency}
                </strong>
                <ActorSignature actor={p.actor} unknown={d.unknownActor} />
              </div>
              <span>{d.priceReasons[p.reason]}</span>
              <EventTime value={p.set_at} locale={locale} />
            </li>
          ))}
        </ul>
      </details>
      <details className="card intake-form item-detail-section">
        <summary>
          {d.events} <span>({events.length})</span>
        </summary>
        <ul className="item-detail-history">
          {events.map((e) => (
            <li key={e.id}>
              <div className="item-actor-line">
                <strong>{d.eventKinds[e.kind]}</strong>
                <ActorSignature actor={e.actor} unknown={d.unknownActor} />
              </div>
              <EventTime value={e.occurred_at} locale={locale} />
              <EventDetails
                event={e}
                currency={currency}
                locale={locale}
                d={d}
              />
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}

function EventDetails({
  event,
  currency,
  locale,
  d,
}: {
  event: Detail['events'][number]
  currency: string
  locale: Locale
  d: Dictionary['items']
}) {
  const { kind, detail } = event
  const t = d.eventDetails
  const facts: [string, string][] = []
  if (kind === 'collection_recorded') {
    const collection = itemCollectionDetail.safeParse(detail)
    if (collection.success) {
      facts.push([
        t.collection,
        collection.data.collected ? t.collected : t.notCollected,
      ])
      facts.push([
        t.observedOn,
        economyFormat(locale).date(collection.data.observedOn),
      ])
    }
  }
  const reason =
    typeof detail.reason === 'string'
      ? detail.reason
      : typeof detail.note === 'string'
        ? detail.note
        : null
  if (
    (kind === 'period_ended' || kind === 'period_end_corrected') &&
    typeof detail.action === 'string' &&
    Object.hasOwn(t.actions, detail.action)
  )
    facts.push([t.action, t.actions[detail.action as keyof typeof t.actions]])
  if (
    kind === 'period_end_corrected' &&
    typeof detail.previousAction === 'string' &&
    Object.hasOwn(t.actions, detail.previousAction)
  )
    facts.push([
      t.previousAction,
      t.actions[detail.previousAction as keyof typeof t.actions],
    ])
  if (kind === 'period_reopened') {
    const day = z.iso.date().safeParse(detail.saleEndsOn)
    if (day.success)
      facts.push([t.saleEndsOn, economyFormat(locale).date(day.data)])
  }
  if (
    kind === 'period_extended' &&
    Number.isSafeInteger(detail.days) &&
    Number(detail.days) > 0
  )
    facts.push([t.days, String(detail.days)])
  if (kind === 'price_set' || kind === 'markdown_applied') {
    const amount = (value: unknown) => {
      if (!(
        typeof value === 'number' ||
        (typeof value === 'string' && /^\d+$/.test(value))
      ))
        return null
      const n = Number(value)
      return Number.isSafeInteger(n) && n >= 0
        ? economyFormat(locale).money(n, currency)
        : null
    }
    const current = amount(detail.priceOre)
    const previous = amount(detail.previousPriceOre)
    if (current)
      facts.push([
        previous ? t.priceChange : t.price,
        previous ? `${previous} → ${current}` : current,
      ])
  }
  if (
    reason &&
    [
      'period_ended',
      'period_extended',
      'price_set',
      'markdown_applied',
      'returned',
      'collection_recorded',
      'period_reopened',
      'period_end_corrected',
    ].includes(kind)
  ) {
    const recordedReason =
      kind === 'price_set' && Object.hasOwn(d.priceReasons, reason)
        ? d.priceReasons[reason as keyof typeof d.priceReasons]
        : reason
    facts.push([t.reason, recordedReason])
  }
  if (!facts.length) return null
  return (
    <dl className="item-event-details">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
