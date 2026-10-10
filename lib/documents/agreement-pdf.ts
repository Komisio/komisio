import PDFDocument from 'pdfkit'
import { join } from 'node:path'
import { dictionary, intlLocale, localeNames, type Locale } from '../i18n'

export type AgreementDocument = {
  agreement: {
    id: string
    version: number
    title: string
    body: string
    language: Locale
  }
  storeName: string
  sellerName?: string
}

/** A read-only copy of published terms, never evidence of a signature. */
export async function renderAgreementPdf(input: AgreementDocument) {
  const { agreement, storeName, sellerName } = input
  const a = dictionary(agreement.language).agreements
  const regular = join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf')
  const bold = join(process.cwd(), 'assets/fonts/NotoSans-Bold.ttf')
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 52, bottom: 64, left: 52, right: 52 },
    bufferPages: true,
    font: regular,
    info: { Title: agreement.title, Author: storeName, Creator: 'Komisio' },
    lang: intlLocale(agreement.language),
  })
  const chunks: Buffer[] = []
  const completed = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    doc.on('error', reject)
  })
  doc.registerFont('Regular', regular).registerFont('Bold', bold)
  const width = doc.page.width - 104
  doc.font('Bold').fontSize(10).fillColor('#365448').text(storeName)
  doc.moveDown(0.7)
  doc.fontSize(21).fillColor('#17231d').text(agreement.title, { lineGap: 3 })
  doc.moveDown(0.5)
  doc.font('Regular').fontSize(10).fillColor('#45534b')
  doc.text(
    `${a.version} ${agreement.version} · ${localeNames[agreement.language]}`,
  )
  doc.moveDown(1)
  doc.font('Bold').fontSize(11).fillColor('#17231d')
  doc.text(
    `${a.usage.sellerName}: ${sellerName || '________________________________'}`,
  )
  doc.moveDown(1.2)
  doc.font('Regular').fontSize(10.5).fillColor('#17231d')
  // Published text stays literal. Never interpolate placeholders or parse HTML.
  doc.text(agreement.body, { width, lineGap: 4, paragraphGap: 5 })
  doc.moveDown(1.5)
  if (doc.y + 132 > doc.page.height - 64) {
    doc.addPage()
    // A detached signature sheet must still identify the parties and terms.
    doc.font('Bold').fontSize(14).text(agreement.title)
    doc.moveDown(0.5)
    doc.font('Regular').fontSize(10).text(storeName)
    doc.text(
      `${a.version} ${agreement.version} · ${localeNames[agreement.language]}`,
    )
    doc.moveDown(1)
    doc.text(
      `${a.usage.sellerName}: ${sellerName || '________________________________'}`,
    )
    doc.moveDown(1.5)
  }
  const top = doc.y
  doc.font('Regular').fontSize(9).fillColor('#45534b')
  doc.text(a.usage.date, 52, top)
  doc
    .moveTo(52, top + 32)
    .lineTo(240, top + 32)
    .strokeColor('#8b978f')
    .stroke()
  const signatureTop = top + 55
  doc.text(a.usage.sellerSignature, 52, signatureTop)
  doc.text(a.usage.storeSignature, 315, signatureTop)
  doc
    .moveTo(52, signatureTop + 40)
    .lineTo(280, signatureTop + 40)
    .stroke()
  doc
    .moveTo(315, signatureTop + 40)
    .lineTo(543, signatureTop + 40)
    .stroke()
  const pages = doc.bufferedPageRange()
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page)
    // Footer text is outside the body margins and must not trigger a new page.
    const bottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.font('Regular').fontSize(8).fillColor('#65736a')
    doc.text(
      `Komisio · ${a.version} ${agreement.version}`,
      52,
      doc.page.height - 43,
      {
        width: width - 70,
        lineBreak: false,
      },
    )
    doc.text(`${page + 1} / ${pages.count}`, 483, doc.page.height - 43, {
      width: 60,
      align: 'right',
      lineBreak: false,
    })
    doc
      .fontSize(7)
      .text(agreement.id, 52, doc.page.height - 29, { lineBreak: false })
    doc.page.margins.bottom = bottom
  }
  doc.end()
  return completed
}

export function agreementPdfResponse(
  bytes: Uint8Array,
  version: number,
  language: Locale,
) {
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="agreement-v${version}-${language}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
