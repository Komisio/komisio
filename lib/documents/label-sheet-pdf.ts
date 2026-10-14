import PDFDocument from 'pdfkit'
import { join } from 'node:path'
import { z } from 'zod'
import { itemLabel } from '../engine/item-label'
import { formatOre } from '../engine/items'
import { itemBarcode } from '../labels/browser-barcode'

export const sheetSizes = {
  '50x50': { width: 50, height: 50, columns: 3, rows: 5 },
  '57x32': { width: 57, height: 32, columns: 3, rows: 8 },
} as const
const mm = (n: number) => (n * 72) / 25.4

/** Draw our own validated barcode output as vectors, preserving quiet zones. */
function barcode(
  doc: PDFKit.PDFDocument,
  reference: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const svg = itemBarcode(reference)
  const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
  const paths = [
    ...svg.matchAll(
      /<path stroke="#000000" stroke-width="(\d+)" d="([ML\d .-]+)"\s*\/?\s*>/g,
    ),
  ]
  if (
    !box ||
    !paths.length ||
    paths.length !== (svg.match(/<path /g)?.length ?? 0)
  )
    throw new Error('Unexpected barcode geometry')
  doc
    .save()
    .translate(x, y)
    .scale(width / Number(box[1]), height / Number(box[2]))
  for (const path of paths)
    doc.lineWidth(Number(path[1])).path(path[2]).stroke('#000000')
  doc.restore()
}

export async function renderLabelSheetPdf(input: {
  storeName: string
  items: z.infer<typeof itemLabel>[]
  size: keyof typeof sheetSizes
  copies: number
}) {
  const items = z.array(itemLabel).min(1).max(200).parse(input.items)
  const copies = z.number().int().min(1).max(10).parse(input.copies)
  if (items.length * copies > 400) throw new Error('Too many labels')
  const size = sheetSizes[input.size]
  if (!size) throw new Error('Invalid label size')
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    font: join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'),
    info: { Title: 'Komisio labels', Creator: 'Komisio' },
  })
  doc.registerFont(
    'regular',
    join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'),
  )
  doc.registerFont(
    'bold',
    join(process.cwd(), 'assets/fonts/NotoSans-Bold.ttf'),
  )
  const chunks: Buffer[] = []
  const completed = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    doc.on('error', reject)
  })
  const labels = items.flatMap((item) =>
    Array.from({ length: copies }, () => item),
  )
  const perPage = size.columns * size.rows
  const left = (doc.page.width - mm(size.width * size.columns)) / 2
  const top = (doc.page.height - mm(size.height * size.rows)) / 2
  labels.forEach((item, index) => {
    if (index && index % perPage === 0) doc.addPage()
    const slot = index % perPage
    const x = left + mm((slot % size.columns) * size.width)
    const y = top + mm(Math.floor(slot / size.columns) * size.height)
    const width = mm(size.width),
      height = mm(size.height),
      inset = mm(2)
    doc.rect(x, y, width, height).lineWidth(0.2).stroke('#bbbbbb')
    doc
      .save()
      .rect(x + inset, y + inset, width - 2 * inset, height - 2 * inset)
      .clip()
    const textWidth = width - 2 * inset
    doc
      .font('regular')
      .fontSize(6.5)
      .fillColor('#000000')
      .text(input.storeName, x + inset, y + inset, {
        width: textWidth,
        height: 10,
        ellipsis: true,
        align: 'center',
      })
    doc
      .font('bold')
      .fontSize(size.height === 32 ? 7 : 8)
      .text(item.title || item.reference, x + inset, y + mm(5.5), {
        width: textWidth,
        height: size.height === 32 ? 19 : 35,
        ellipsis: true,
        align: 'center',
      })
    doc
      .fontSize(12)
      .text(
        item.priceOre === null
          ? '—'
          : `${formatOre(item.priceOre)} ${item.currency}`,
        x + inset,
        y + height - mm(20),
        { width: textWidth, height: 18, align: 'center' },
      )
    barcode(
      doc,
      item.reference,
      x + inset,
      y + height - mm(14),
      textWidth,
      mm(8),
    )
    doc
      .font('regular')
      .fontSize(6.5)
      .text(item.reference, x + inset, y + height - mm(5), {
        width: textWidth,
        height: 9,
        align: 'center',
      })
    doc.restore()
  })
  doc.end()
  return completed
}
