import PDFDocument from 'pdfkit'
import { join } from 'node:path'
import { z } from 'zod'
import { itemLabel } from '../../lib/engine/item-label'
import { drawItemLabel } from '../../lib/documents/label-sheet-pdf'
import type { Locale } from '../../lib/i18n'

const mm = (value: number) => (value * 72) / 25.4

/** Prototype only; no route, printer setting or production UI calls this. */
export async function renderSingleLabelPages(input: {
  storeName: string
  items: z.input<typeof itemLabel>[]
  widthMm: number
  heightMm: number
  copies: number
  locale?: Locale
}) {
  const items = z.array(itemLabel).min(1).max(200).parse(input.items)
  const width = z.number().finite().min(20).max(120).parse(input.widthMm)
  const height = z.number().finite().min(15).max(200).parse(input.heightMm)
  const copies = z.number().int().min(1).max(10).parse(input.copies)
  if (copies * items.length > 400) throw new Error('Too many labels')
  // Keep the proven 57 × 32 mm drawing at 1:1. Small formats need their own
  // readable layout, not an automatic reduction of text and barcode modules.
  if (width < 57 || height < 32) throw new Error('LABEL_LAYOUT_TOO_SMALL')
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    font: join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'),
    info: { Title: 'Komisio single-label prototype', Creator: 'Komisio' },
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
  const output = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    doc.on('error', reject)
  })
  for (const item of items) {
    for (let copy = 0; copy < copies; copy++) {
      doc.addPage({ size: [mm(width), mm(height)], margin: 0 })
      drawItemLabel(
        doc,
        item,
        input.storeName,
        mm((width - 57) / 2),
        mm((height - 32) / 2),
        { width: 57, height: 32 },
        input.locale,
      )
    }
  }
  doc.end()
  return output
}
