import type { Dictionary, Locale } from '@/lib/i18n'
import { formatOre, type readItem } from '@/lib/engine/items'
import { ActorSignature } from './actor-signature'
import { EventTime } from '@/components/ui/event-time'

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
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}
