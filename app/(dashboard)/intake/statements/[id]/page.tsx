import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readStatement } from '@/lib/engine/statements'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { PrintLabel } from '@/components/intake/print-label'

export default async function Statement({
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
    d = all.statements
  const result = await readStatement(ctx.client, active.id, id.data)
  if (!result) notFound()
  const { statement: s, lines } = result
  const seller = await ctx.client
    .from('sellers')
    .select('name,email,phone')
    .eq('tenant_id', active.id)
    .eq('id', s.seller_id)
    .single()
  if (seller.error) throw new Error('Unable to read seller')
  const locale = ctx.locale === 'sv' ? 'sv-SE' : 'en-GB'
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { timeZone: 'Europe/Stockholm' })
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { timeZone: 'Europe/Stockholm' })
  const money = (ore: number) => `${formatSignedOre(ore)} ${currency}`
  const lastDay = new Date(Date.parse(s.period_to) - 1).toISOString()
  return (
    <>
      <div className="page-heading no-print">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href={`/intake/sellers/${s.seller_id}`}>
          {all.sellerTerms.title}
        </Link>
      </div>
      <article className="card intake-form statement">
        <p className="eyebrow">{active.name}</p>
        <h2>
          {s.kind === 'credit_note' ? d.creditNote : d.statement} {s.number}
        </h2>
        <p>
          {seller.data.name}
          {seller.data.email ? ` · ${seller.data.email}` : ''}
          {seller.data.phone ? ` · ${seller.data.phone}` : ''}
        </p>
        <p>
          {d.period}: {day(s.period_from)} – {day(lastDay)} · {d.issuedAt}{' '}
          {when(s.issued_at)}
        </p>
        {s.corrects_id && (
          <p>
            {d.corrects}{' '}
            <Link
              className="text-link"
              href={`/intake/statements/${s.corrects_id}`}
            >
              {d.original}
            </Link>
          </p>
        )}
        <dl>
          <div>
            <dt>{d.opening}</dt>
            <dd>{money(s.opening_ore)}</dd>
          </div>
          <div>
            <dt>{d.salesGross}</dt>
            <dd>{money(s.sales_gross_ore)}</dd>
          </div>
          <div>
            <dt>{d.commission}</dt>
            <dd>{money(s.commission_ore)}</dd>
          </div>
          <div>
            <dt>{d.credited}</dt>
            <dd>{money(s.credited_ore)}</dd>
          </div>
          <div>
            <dt>{d.reversed}</dt>
            <dd>{money(s.reversed_ore)}</dd>
          </div>
          <div>
            <dt>{d.paid}</dt>
            <dd>{money(s.paid_ore)}</dd>
          </div>
          <div>
            <dt>{d.adjustments}</dt>
            <dd>{money(s.adjustments_ore)}</dd>
          </div>
          <div>
            <dt>{d.closing}</dt>
            <dd>
              <strong>{money(s.closing_ore)}</strong>
            </dd>
          </div>
        </dl>
        <h3>{d.lines}</h3>
        {lines.length === 0 && <p>{d.noLines}</p>}
        <table>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{when(l.occurred_at)}</td>
                <td>
                  {all.ledger.kinds[l.kind as keyof typeof all.ledger.kinds] ??
                    l.kind}
                </td>
                <td>
                  {l.sale_price_ore !== null
                    ? `${d.salePrice} ${money(l.sale_price_ore)} · ${d.commission} ${money(l.commission_ore ?? 0)}`
                    : ''}
                </td>
                <td>{money(l.amount_ore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <small>{d.footer.replace('{currency}', currency)}</small>
        </p>
      </article>
      <div className="row no-print">
        <PrintLabel label={d.print} />
      </div>
    </>
  )
}
