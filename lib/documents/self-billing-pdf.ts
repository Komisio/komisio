import PDFDocument from 'pdfkit'
import { join } from 'node:path'
import { dictionary, intlLocale, type Locale } from '../i18n'
import { selfBillingContent } from './self-billing-content'
import { statementTitle, type SelfBilling } from '../engine/self-billing'

export type SelfBillingDocument = {
  id: string
  number: number
  kind: string
  corrects_id?: string | null
  period_from: string
  period_to: string
  issued_at?: string
  opening_ore: number
  closing_ore: number
  sales_gross_ore?: number
  commission_ore?: number
  credited_ore?: number
  reversed_ore?: number
  paid_ore?: number
  adjustments_ore?: number
  self_billing: SelfBilling
}

/** Generated solely from the immutable statement; rendering never writes data. */
export async function renderSelfBillingPdf(
  s: SelfBillingDocument,
  locale: Locale,
) {
  const invoice = s.self_billing
  const { d, money, supplierDetails, buyerDetails, lines, totals } =
    selfBillingContent(invoice, locale)
  const title = `${statementTitle(s, d)} ${s.number}`
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 56, left: 48, right: 48 },
    bufferPages: true,
    font: join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'),
    lang: intlLocale(locale),
    info: { Title: title, Author: invoice.buyer.name, Creator: 'Komisio' },
  })
  doc.registerFont(
    'Regular',
    join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'),
  )
  doc.registerFont(
    'Bold',
    join(process.cwd(), 'assets/fonts/NotoSans-Bold.ttf'),
  )
  const chunks: Buffer[] = []
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('data', (b: Buffer) => chunks.push(b))
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    doc.on('error', reject)
  })
  const width = doc.page.width - 96
  const text = (value: string, bold = false, size = 10) => {
    doc
      .font(bold ? 'Bold' : 'Regular')
      .fontSize(size)
      .fillColor('#17231d')
      .text(value, { width, lineGap: 2 })
    doc.moveDown(0.35)
  }
  const day = (v: string) =>
    new Date(v).toLocaleDateString(intlLocale(locale), {
      timeZone: 'Europe/Stockholm',
    })
  const room = (height: number) => {
    if (doc.y + height > doc.page.height - 56) doc.addPage()
  }
  text(invoice.buyer.name, true, 11)
  text(title, true, 22)
  text(
    `${d.period}: ${day(s.period_from)} - ${day(new Date(Date.parse(s.period_to) - 1).toISOString())}`,
  )
  if (s.issued_at) text(`${d.issuedAt}: ${day(s.issued_at)}`)
  if (s.corrects_id) text(`${d.corrects}: ${s.corrects_id}`)
  text(d.supplier, true, 12)
  for (const v of supplierDetails) text(v)
  text(d.buyer, true, 12)
  for (const v of buyerDetails) text(v)
  text(d.invoiceNote)
  const row = (v: {
    rate: string
    net: string
    vat: string
    gross: string
  }) => {
    text(`${d.vatRate}: ${v.rate}`)
    text(`${d.supplierNet}: ${v.net}   |   ${d.supplierVat}: ${v.vat}`)
    text(`${d.supplierGross}: ${v.gross}`, true)
  }
  for (const l of lines) {
    // Keep the label and its monetary facts together, including long item names.
    doc.font('Bold').fontSize(11)
    room(doc.heightOfString(l.title, { width }) + 150)
    text(l.title, true, 11)
    text(l.detail, false, 8)
    row(l)
    doc.moveDown(0.5)
  }
  room(120)
  text(d.invoiceTotals, true, 13)
  for (const t of totals) {
    room(90)
    row(t)
  }
  room(170)
  text(dictionary(locale).statements.title, true, 13)
  for (const [label, value] of [
    [d.opening, s.opening_ore],
    [d.salesGross, s.sales_gross_ore],
    [d.commission, s.commission_ore],
    [d.credited, s.credited_ore],
    [d.reversed, s.reversed_ore],
    [d.paid, s.paid_ore],
    [d.adjustments, s.adjustments_ore],
    [d.closing, s.closing_ore],
  ] as const) {
    if (value !== undefined) text(`${label}: ${money(value)}`)
  }
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const bottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.font('Regular').fontSize(8).fillColor('#58645e')
    doc.text(`${title} · ${i + 1}/${range.count}`, 48, doc.page.height - 38, {
      width,
      lineBreak: false,
    })
    doc.page.margins.bottom = bottom
  }
  doc.end()
  return done
}
export function selfBillingPdfResponse(bytes: Uint8Array, number: number) {
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="self-billing-${number}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
