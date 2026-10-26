import type { Dictionary, Locale } from '@/lib/i18n'
import { intlLocale } from '@/lib/i18n'
import { economyFormat } from '@/lib/intake/economy-format'
import {
  type MyItems,
  sellerItemDaysLeft,
  sellerItemNextStep,
  sellerItemState,
} from '@/lib/engine/seller-items'

/** Read-only seller projection: never link into staff-only item pages. */
export function SellerItems({
  mine,
  locale,
  d,
}: {
  mine: MyItems
  locale: Locale
  d: Dictionary['sellerPortal']
}) {
  const format = economyFormat(locale)
  const money = (ore: number) => format.money(ore, mine.currency)
  const day = (value: string) =>
    new Date(value).toLocaleDateString(intlLocale(locale), {
      timeZone: 'Europe/Stockholm',
      dateStyle: 'medium',
    })
  const date = (value: string) => (
    <time
      dateTime={value}
      title={new Date(value).toLocaleString(intlLocale(locale), {
        timeZone: 'Europe/Stockholm',
      })}
    >
      {day(value)}
    </time>
  )
  return (
    <table className="seller-items" aria-label={d.items}>
      <thead>
        <tr>
          <th scope="col">{d.item}</th>
          <th scope="col">{d.price}</th>
          <th scope="col">{d.status}</th>
          <th scope="col">{d.itemDate}</th>
        </tr>
      </thead>
      <tbody>
        {mine.items.map((item) => {
          const state = sellerItemState(item)
          const next = sellerItemNextStep(item)
          const price =
            state === 'sold' && item.soldPriceOre !== null
              ? item.soldPriceOre
              : item.currentPriceOre
          const reduced =
            state !== 'sold' &&
            item.acceptedPriceOre !== null &&
            item.currentPriceOre !== null &&
            item.currentPriceOre < item.acceptedPriceOre
          const active = state === 'forSale' || state === 'periodEnding'
          const ended = item.endedAs
            ? (d.endedAs[item.endedAs as keyof typeof d.endedAs] ?? d.kind)
            : ''
          return (
            <tr key={item.id}>
              <td className="seller-item-identity">
                <strong>{item.title || item.reference}</strong>
                <small className="seller-item-reference">
                  {item.reference}
                </small>
                {item.category && (
                  <span className="seller-item-category">{item.category}</span>
                )}
              </td>
              <td className="seller-item-price" data-label={d.price}>
                <strong>{price === null ? '—' : money(price)}</strong>
                {reduced && item.acceptedPriceOre !== null && (
                  <small>
                    {d.wasPrice} {money(item.acceptedPriceOre)}
                  </small>
                )}
              </td>
              <td className="seller-item-state">
                <span
                  className={`seller-item-badge seller-item-badge-${state}`}
                >
                  {d.itemStates[state]}
                </span>
                {state === 'ended' && ended && <small>{ended}</small>}
                {(state === 'periodEnding' || state === 'periodEnded') &&
                  item.endOfPeriodAction && (
                    <small>
                      {d.then} {d.endActions[item.endOfPeriodAction]}
                    </small>
                  )}
                {active && (
                  <details className="seller-item-plan">
                    <summary>{d.itemDetails}</summary>
                    <div>
                      {next !== undefined && (
                        <p>
                          {next
                            ? (mine.automaticMarkdowns
                                ? d.nextPriceScheduled
                                : d.nextPriceManual
                              )
                                .replace('{price}', money(next.priceOre))
                                .replace('{date}', day(next.at))
                            : d.lastPrice}
                        </p>
                      )}
                      <p>
                        {d.daysLeft.replace(
                          '{days}',
                          format.number(sellerItemDaysLeft(item)),
                        )}
                      </p>
                      {state === 'forSale' && item.endOfPeriodAction && (
                        <p>
                          {d.then} {d.endActions[item.endOfPeriodAction]}
                        </p>
                      )}
                    </div>
                  </details>
                )}
              </td>
              <td className="seller-item-date" data-label={d.itemDate}>
                {state === 'sold' && item.soldAt ? (
                  <span>
                    {d.soldOn} {date(item.soldAt)}
                  </span>
                ) : state === 'ended' || state === 'periodEnded' ? (
                  <span>
                    {d.endedOn} {item.endedAt ? date(item.endedAt) : '—'}
                  </span>
                ) : (
                  <>
                    <span>
                      {d.forSaleUntil} {date(item.periodEnd)}
                    </span>
                  </>
                )}
                {state !== 'sold' &&
                  state !== 'ended' &&
                  item.collectionDeadline && (
                    <small>
                      {d.collectionDeadline} {date(item.collectionDeadline)}
                    </small>
                  )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
