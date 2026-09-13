import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
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
    new Date(iso).toLocaleString(ctx.locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  return (
    <>
      <Link className="text-link" href="/intake/sales">
        {d.backToList}
      </Link>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>
          {d.receipt} {formatOre(sale.total_ore)} SEK
        </h1>
        <p>
          {when(sale.occurred_at)} · {d.providers[sale.provider]} ·{' '}
          {sale.external_id} · {d.statuses[sale.status]}
        </p>
      </div>
      <section className="card intake-form">
        <h2>{d.lines}</h2>
        <p>{d.linesHint}</p>
        {lines.map((l) => (
          <div key={l.id} className="intake-notice">
            <strong>
              {d.line} {l.line_no} · {formatOre(l.price_ore)} SEK ·{' '}
              {all.items.ownershipKinds[l.ownership]}
            </strong>
            <p>
              <Link className="text-link" href={`/intake/items/${l.item_id}`}>
                {all.items.open}
              </Link>
            </p>
            {l.ownership === 'consignment' && (
              <p>
                {d.commission}: {formatOre(l.commission_ore)} SEK (
                {l.commission_rate_percent} %,{' '}
                {l.commission_basis ? all.sellerTerms[l.commission_basis] : ''})
                {l.commission_vat_ore > 0
                  ? ` + ${d.commissionVat} ${formatOre(l.commission_vat_ore)} SEK`
                  : ''}{' '}
                · {d.sellerCredit}: {formatOre(l.seller_credit_ore)} SEK
              </p>
            )}
            <p>
              {d.vat}: {formatOre(l.vat_ore)} SEK · {d.vatModes[l.vat_mode]} ·{' '}
              {l.vat_rate_bp / 100} %
            </p>
            {returns.has(l.id) ? (
              <p role="status">
                {all.returns.returned} {when(returns.get(l.id)!.occurred_at)} ·{' '}
                {returns.get(l.id)!.reason}
                {returns.get(l.id)!.flagged_for_review
                  ? ` · ${all.returns.flagged}`
                  : ''}
              </p>
            ) : write && sale.status === 'completed' ? (
              <ReturnForm
                tenantId={active.id}
                saleLineId={l.id}
                refund={formatOre(l.price_ore)}
                d={all.returns}
                intake={all.intake}
              />
            ) : null}
          </div>
        ))}
      </section>
    </>
  )
}
