import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readSale, formatOre } from '@/lib/engine/sales'
import { readReturnsForLines } from '@/lib/engine/returns'
import { ReturnForm } from '@/components/intake/return-form'

export default async function Sale({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.uuid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, active.id),
    all = dictionary(ctx.locale),
    d = all.sales
  const result = await readSale(ctx.client, active.id, id.data)
  if (!result) notFound()
  const { sale, lines } = result
  const returns = await readReturnsForLines(
    ctx.client,
    active.id,
    lines.map((l) => l.id),
  )
  const write = active.role !== 'readonly'
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(ctx.locale), {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  return (
    <div className="sale-detail">
      <Link className="text-link" href="/intake/sales">
        {d.backToList}
      </Link>
      <div className="page-heading">
        <h1>
          {d.receipt} {formatOre(sale.total_ore)} {currency}
        </h1>
        <p>
          {when(sale.occurred_at)} · {d.providers[sale.provider]} ·{' '}
          {d.statuses[sale.status]}
        </p>
        <details className="sale-reference">
          <summary>{d.reference}</summary>
          <p>{sale.external_id}</p>
        </details>
      </div>
      <section className="card sales-register">
        <h2>{d.lines}</h2>
        {lines.map((l) => (
          <article key={l.id} className="sale-line">
            <div className="sale-line-heading">
              <h3>
                {d.line} {l.line_no}
              </h3>
              <strong>
                {formatOre(l.price_ore)} {currency}
              </strong>
            </div>
            <p className="sale-line-item">
              <Link className="text-link" href={`/intake/items/${l.item_id}`}>
                {all.items.open} · I-{l.item_id.slice(0, 8).toUpperCase()}
              </Link>
            </p>
            <details className="sale-line-details">
              <summary>{d.financialDetails}</summary>
              <p className="muted">{d.linesHint}</p>
              <p>{all.items.ownershipKinds[l.ownership]}</p>
              {l.ownership === 'consignment' && (
                <p>
                  {d.commission}: {formatOre(l.commission_ore)} {currency} (
                  {l.commission_rate_percent} %,{' '}
                  {l.commission_basis
                    ? all.sellerTerms[l.commission_basis]
                    : ''}
                  )
                  {l.commission_vat_ore > 0
                    ? ` + ${d.commissionVat} ${formatOre(l.commission_vat_ore)} ${currency}`
                    : ''}{' '}
                  · {d.sellerCredit}: {formatOre(l.seller_credit_ore)}{' '}
                  {currency}
                </p>
              )}
              <p>
                {d.vat}: {formatOre(l.vat_ore)} {currency} ·{' '}
                {d.vatModes[l.vat_mode]} · {l.vat_rate_bp / 100} %
              </p>
            </details>
            {returns.has(l.id) ? (
              <p role="status">
                {all.returns.returned} {when(returns.get(l.id)!.occurred_at)} ·{' '}
                {returns.get(l.id)!.reason}
                {returns.get(l.id)!.flagged_for_review
                  ? ` · ${all.returns.flagged}`
                  : ''}
              </p>
            ) : write && sale.status === 'completed' ? (
              <details className="sale-return">
                <summary>{all.returns.record}</summary>
                <ReturnForm
                  tenantId={active.id}
                  saleLineId={l.id}
                  refund={formatOre(l.price_ore)}
                  d={all.returns}
                  intake={all.intake}
                />
              </details>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  )
}
