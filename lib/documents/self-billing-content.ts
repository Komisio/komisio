import type { SelfBilling } from '../engine/self-billing'
import { formatSignedOre } from '../engine/seller-ledger'
import { dictionary, intlLocale, type Locale } from '../i18n'

/** Presentation of frozen facts only. No VAT is recomputed here. */
export function selfBillingContent(invoice: SelfBilling, locale: Locale) {
  const all = dictionary(locale),
    d = all.statements,
    b = all.sellerDetails.business
  const money = (ore: number) => `${formatSignedOre(ore)} ${invoice.currency}`
  const rate = (bp: number | null) =>
    bp === null ? d.noSeparateVat : `${bp / 100} %`
  const supplier = invoice.supplier
  const business = supplier.business
  const supplierDetails = [
    supplier.name,
    supplier.email,
    supplier.phone,
    [
      supplier.addressLine1,
      supplier.addressLine2,
      supplier.postalCode,
      supplier.city,
      supplier.country,
    ]
      .filter(Boolean)
      .join(', '),
    ...(
      [
        'companyName',
        'organisationNumber',
        'vatNumber',
        'contactPerson',
        'billingAddress',
        'invoiceEmail',
        'invoiceReference',
      ] as const
    ).map((k) => (business[k] ? `${b[k]}: ${business[k]}` : '')),
  ].filter(Boolean)
  const buyerDetails = [
    invoice.buyer.name,
    Object.values(invoice.buyer.address).filter(Boolean).join(', '),
    invoice.buyer.contact.email,
    invoice.buyer.contact.phone,
  ].filter((s): s is string => !!s)
  const groups = new Map<
    number | null,
    { net: number; vat: number; gross: number }
  >()
  for (const l of invoice.lines) {
    const sum = groups.get(l.rateBp) ?? { net: 0, vat: 0, gross: 0 }
    sum.net += l.netOre
    sum.vat += l.vatOre
    sum.gross += l.grossOre
    groups.set(l.rateBp, sum)
  }
  return {
    d,
    money,
    supplierDetails,
    buyerDetails,
    lines: invoice.lines.map((l) => ({
      key: l.referenceId,
      title: l.description || l.saleLineId,
      detail: `${new Date(l.occurredAt).toLocaleDateString(intlLocale(locale), { timeZone: 'Europe/Stockholm' })} · ${all.ledger.kinds[l.kind]} · ${l.saleLineId}`,
      rate: rate(l.rateBp),
      net: money(l.netOre),
      vat: l.rateBp === null ? '—' : money(l.vatOre),
      gross: money(l.grossOre),
    })),
    totals: [...groups.entries()].map(([bp, v]) => ({
      rate: rate(bp),
      net: money(v.net),
      vat: bp === null ? '—' : money(v.vat),
      gross: money(v.gross),
    })),
  }
}
