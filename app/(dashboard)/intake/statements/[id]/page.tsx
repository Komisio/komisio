import { readStatementSellerContact } from '@/lib/engine/seller-profile'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale, isLocale } from '@/lib/i18n'
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
    currency = await readStoreCurrency(ctx.client, active.id)
  const result = await readStatement(ctx.client, active.id, id.data)
  if (!result) notFound()
  const { statement: s, lines } = result
  const seller =
    s.seller_contact ??
    (await readStatementSellerContact(ctx.client, active.id, s.seller_id))
  const documentLanguage = isLocale(s.seller_contact?.language)
    ? s.seller_contact.language
    : ctx.locale
  const all = dictionary(documentLanguage),
    d = all.statements
  const locale = intlLocale(documentLanguage)
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
          {seller.name}
          {seller.email ? ` · ${seller.email}` : ''}
          {seller.phone ? ` · ${seller.phone}` : ''}
        </p>
        {s.seller_contact && (
          <p>
            {[
              s.seller_contact.addressLine1,
              s.seller_contact.addressLine2,
              s.seller_contact.postalCode,
              s.seller_contact.city,
              s.seller_contact.country,
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
        )}
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
