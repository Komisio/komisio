import PDFDocument from 'pdfkit'
import { join } from 'node:path'
import type { SaleSummary } from '../engine/sale-summary'
import { formatOre } from '../engine/sales'
import { dictionary, intlLocale } from '../i18n'

export async function renderSaleSummaryPdf(summary: SaleSummary) {
  const d = dictionary(summary.locale).saleSummary
  const regular = join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf')
  const bold = join(process.cwd(), 'assets/fonts/NotoSans-Bold.ttf')
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 52, bottom: 64, left: 52, right: 52 },
    font: regular,
    bufferPages: true,
    info: { Title: d.title, Author: summary.storeName, Creator: 'Komisio' },
    lang: intlLocale(summary.locale),
  })
  const chunks: Buffer[] = []
  const result = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    doc.on('error', reject)
  })
  doc.registerFont('Regular', regular).registerFont('Bold', bold)
  const width = doc.page.width - 104
  const money = (ore: string) => `${formatOre(ore)} ${summary.currency}`
  const when = (date: string) =>
    new Date(date).toLocaleString(intlLocale(summary.locale), {
      timeZone: 'Europe/Stockholm',
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  const ensure = (height: number) => {
    if (doc.y + height > doc.page.height - 64) doc.addPage()
  }
  doc.fillColor('#17231d').font('Bold').fontSize(12).text(summary.storeName)
  if (summary.address) doc.font('Regular').fontSize(9).text(summary.address)
  doc.moveDown().font('Bold').fontSize(23).text(d.title)
  doc.moveDown(0.4).font('Regular').fontSize(10)
  doc.text(`${d.saleDate}: ${when(summary.occurredAt)}`)
  doc.text(`${d.reference}: ${summary.reference}`)
  if (summary.status === 'reversed')
    doc.font('Bold').text(d.reversed).font('Regular')
  doc.moveDown(0.8).fontSize(9).fillColor('#45534b').text(d.notice)
  doc.moveDown(1.2)
  for (const line of summary.lines) {
    doc.font('Bold').fontSize(11).fillColor('#17231d')
    const title = line.title || line.reference
    const titleHeight = doc.heightOfString(title, { width: width - 150 })
    ensure(Math.min(titleHeight + 56, 640))
    const top = doc.y
    doc.text(money(line.priceOre), 52 + width - 140, top, {
      width: 140,
      align: 'right',
    })
    const priceBottom = doc.y
    doc.text(title, 52, top, { width: width - 150 })
    doc.y = Math.max(doc.y, priceBottom)
    doc.font('Regular').fontSize(9).fillColor('#45534b')
    doc.text(line.reference, 52, doc.y + 3, { width })
    for (const attribute of line.attributes) doc.text(attribute, { width })
    if (line.returned)
      doc
        .font('Bold')
        .text(
          `${d.returned}: ${when(line.returned.occurredAt)} · ${money(line.returned.amountOre)}`,
          { width },
        )
        .font('Regular')
    doc.moveDown(0.8)
  }
  ensure(115)
  doc
    .moveTo(52, doc.y)
    .lineTo(52 + width, doc.y)
    .strokeColor('#cbd5ce')
    .stroke()
  doc.moveDown(0.7).font('Bold').fontSize(12).fillColor('#17231d')
  doc.text(`${d.originalTotal}: ${money(summary.totalOre)}`, 52, doc.y, {
    width,
    align: 'right',
  })
  const returned = summary.lines.reduce(
    (sum, line) => sum + BigInt(line.returned?.amountOre ?? '0'),
    0n,
  )
  if (summary.lines.some((line) => line.returned))
    doc
      .font('Regular')
      .fontSize(10)
      .text(`${d.returnTotal}: ${money(String(returned))}`, {
        width,
        align: 'right',
      })
  doc.moveDown(1).font('Regular').fontSize(8).fillColor('#45534b')
  doc.text(d.currentDetails, 52, doc.y, { width })
  doc.text(`${d.generatedAt}: ${when(summary.generatedAt)}`, { width })
  const pages = doc.bufferedPageRange()
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page)
    const bottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.font('Regular').fontSize(7).fillColor('#45534b')
    doc.text(`Komisio · ${summary.id}`, 52, doc.page.height - 38, {
      width: width - 60,
      lineBreak: false,
    })
    doc.text(
      `${page + 1} / ${pages.count}`,
      52 + width - 50,
      doc.page.height - 38,
      { width: 50, align: 'right', lineBreak: false },
    )
    doc.page.margins.bottom = bottom
  }
  doc.end()
  return result
}

export function saleSummaryPdfResponse(bytes: Uint8Array, id: string) {
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="sale-summary-${id}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
