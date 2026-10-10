import Link from 'next/link'
import { EventTime } from '@/components/ui/event-time'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import type { ConsignmentFees } from '@/lib/engine/consignment-fees'
import type { Dictionary, Locale } from '@/lib/i18n'
import { ConsignmentFeeAction } from './consignment-fee-action'

export function ConsignmentFeeHistory({
  fees,
  tenantId,
  sellerId,
  writable = false,
  admin = false,
  d,
  locale,
  page,
  base,
  staff = false,
}: {
  fees: ConsignmentFees | null
  tenantId: string
  sellerId: string
  writable?: boolean
  admin?: boolean
  d: Dictionary
  locale: Locale
  page: number
  base: string
  staff?: boolean
}) {
  if (!fees || fees.total === 0) return null
  const t = d.consignmentFees
  const href = (n: number) =>
    `${base}${base.includes('?') ? '&' : '?'}feePage=${n}#${staff ? 'seller-economy' : 'consignment-fees'}`
  return (
    <section className="card intake-form" id="consignment-fees" tabIndex={-1}>
      <h2>{t.title}</h2>
      <p>{t.historyHelp}</p>
      {writable && (
        <ConsignmentFeeAction
          key={`accrue:${fees.total}`}
          tenantId={tenantId}
          sellerId={sellerId}
          operation="accrue"
          d={d}
        />
      )}
      {fees.rows.map((fee) => (
        <article className="card" key={fee.id}>
          <h3>
            <EventTime value={fee.starts_at} locale={locale} /> —{' '}
            <EventTime value={fee.ends_at} locale={locale} />
          </h3>
          <p>
            <strong>
              {formatSignedOre(fee.gross_ore)} {fee.currency}
            </strong>{' '}
            · {t.status[fee.status]}
          </p>
          <p>
            {t.net}: {formatSignedOre(fee.net_ore)} {fee.currency} · {t.vat}:{' '}
            {formatSignedOre(fee.vat_ore)} {fee.currency}
          </p>
          <p>{t[fee.collection]}</p>
          {fee.payment_reference && (
            <p>
              {t.reference}: {fee.payment_reference}
            </p>
          )}
          {fee.correction_reason && (
            <p>
              {t.reason}: {fee.correction_reason}
            </p>
          )}
          {writable && fee.status === 'unpaid' && (
            <details>
              <summary>{t.pay}</summary>
              <ConsignmentFeeAction
                tenantId={tenantId}
                feeId={fee.id}
                operation="pay"
                d={d}
              />
            </details>
          )}
          {admin && (fee.status === 'unpaid' || fee.status === 'deducted') && (
            <details>
              <summary>{t.reverse}</summary>
              <ConsignmentFeeAction
                tenantId={tenantId}
                feeId={fee.id}
                operation="reverse"
                d={d}
              />
            </details>
          )}
        </article>
      ))}
      {fees.total > 25 && (
        <nav className="items-directory-pagination" aria-label={t.title}>
          {page > 0 && (
            <Link className="btn btn-secondary" href={href(page - 1)}>
              {d.items.previousPage}
            </Link>
          )}
          <span>
            {page + 1} / {Math.ceil(fees.total / 25)}
          </span>
          {(page + 1) * 25 < fees.total && (
            <Link className="btn btn-secondary" href={href(page + 1)}>
              {d.items.nextPage}
            </Link>
          )}
        </nav>
      )}
    </section>
  )
}
