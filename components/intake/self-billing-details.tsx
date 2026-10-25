import type { SelfBilling } from '@/lib/engine/self-billing'
import type { Locale } from '@/lib/i18n'
import { selfBillingContent } from '@/lib/documents/self-billing-content'

export function SelfBillingDetails({
  invoice,
  locale,
}: {
  invoice: SelfBilling
  locale: Locale
}) {
  const { d, supplierDetails, buyerDetails, lines, totals } =
    selfBillingContent(invoice, locale)
  return (
    <section className="self-billing-details">
      <h3>{d.supplier}</h3>
      {supplierDetails.map((s, i) => (
        <p key={i}>{s}</p>
      ))}
      <h3>{d.buyer}</h3>
      {buyerDetails.map((s, i) => (
        <p key={i}>{s}</p>
      ))}
      <p>{d.invoiceNote}</p>
      <h3>{d.invoiceTotals}</h3>
      <table className="statement-lines">
        <caption className="sr-only">{d.invoiceTotals}</caption>
        <thead>
          <tr>
            {[
              d.lines,
              d.vatRate,
              d.supplierNet,
              d.supplierVat,
              d.supplierGross,
            ].map((s) => (
              <th key={s} scope="col">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <td data-label={d.lines}>
                {l.title}
                <br />
                <small className="break-words">{l.detail}</small>
              </td>
              <td data-label={d.vatRate}>{l.rate}</td>
              <td data-label={d.supplierNet}>{l.net}</td>
              <td data-label={d.supplierVat}>{l.vat}</td>
              <td data-label={d.supplierGross}>{l.gross}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {totals.map((t) => (
            <tr key={t.rate}>
              <th scope="row">{d.invoiceTotals}</th>
              <td data-label={d.vatRate}>{t.rate}</td>
              <td data-label={d.supplierNet}>{t.net}</td>
              <td data-label={d.supplierVat}>{t.vat}</td>
              <td data-label={d.supplierGross}>{t.gross}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </section>
  )
}
