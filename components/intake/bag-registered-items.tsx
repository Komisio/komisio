import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import Image from 'next/image'
import { dictionary, intlLocale, type Locale } from '@/lib/i18n'
import type { BagRegisteredPage } from '@/lib/engine/bag-registered-items'
export function BagRegisteredItems({
  data,
  locale,
  currency,
  itemPage,
  href,
}: {
  data: BagRegisteredPage
  locale: Locale
  currency: string
  itemPage: number
  href: (page: number) => string
}) {
  const d = dictionary(locale),
    b = d.bagIntake
  const { items, total, offset, legacy } = data
  const pages = legacy ? 1 : Math.max(1, Math.ceil(total / 25))
  const title = data.scope === 'all' ? b.allRegistered : b.registered
  return (
    <section
      id="bag-registered"
      className="card bag-received-items"
      style={{ scrollMarginTop: '1rem' }}
    >
      <h2>{title}</h2>
      {!legacy && total > 0 && (
        <p>
          <small>
            {d.items.showingRange
              .replace('{from}', String(offset + 1))
              .replace('{to}', String(offset + items.length))
              .replace('{total}', String(total))}
          </small>
        </p>
      )}
      {!items.length ? (
        <p>{b.empty}</p>
      ) : (
        <ul>
          {items.map((item) => {
            const price =
              item.stage === 'sold' ? item.sold_price_ore : item.price_ore
            return (
              <li key={item.id}>
                <Link href={`/intake/items/${item.id}`}>
                  {item.photo_id && item.session_id && (
                    <Image
                      alt=""
                      width={52}
                      height={52}
                      unoptimized
                      loading="lazy"
                      src={`/api/reception/${item.session_id}/photo?photo=${item.photo_id}`}
                    />
                  )}
                  <span>
                    {item.title || d.quickIntake.garment}
                    <small>{'I-' + item.id.slice(0, 8).toUpperCase()}</small>
                    {item.stage && (
                      <small>{d.lifecycle.stages[item.stage]}</small>
                    )}
                  </span>
                  <strong>
                    {price
                      ? new Intl.NumberFormat(intlLocale(locale), {
                          style: 'currency',
                          currency,
                        }).format(Number(price) / 100)
                      : '—'}
                  </strong>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {legacy && items.length === 50 && <p>{b.limit}</p>}
      {pages > 1 && (
        <nav className="row wrap" aria-label={title}>
          {itemPage > 1 && (
            <Link className="btn btn-secondary" href={href(itemPage - 1)}>
              {d.items.previousPage}
            </Link>
          )}
          <span>
            {d.items.pageOf
              .replace('{page}', String(itemPage))
              .replace('{pages}', String(pages))}
          </span>
          {itemPage < pages && (
            <Link className="btn btn-secondary" href={href(itemPage + 1)}>
              {d.items.nextPage}
            </Link>
          )}
        </nav>
      )}
    </section>
  )
}
