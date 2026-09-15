import { z } from 'zod'

// Label templates (P2 S19, sizes 2026-09-15): ZPL as versioned code with a
// fixed layout that scales to the store's label size, and plain-text
// placeholders. Every dynamic value is stripped of ZPL control
// characters so a store name or a note can never change the label program.
export const LABEL_TEMPLATE_VERSION = 'zpl-v2'
export const labelKind = z.enum([
  'bag',
  'garment',
  'item',
  'onboarding',
  'markdown',
])
export type LabelKind = z.infer<typeof labelKind>

const text = (max: number) => z.string().max(max)
export const labelFacts = z.strictObject({
  storeName: text(60),
  reference: text(20),
  line1: text(60).default(''),
  line2: text(60).default(''),
  price: z
    .string()
    .regex(/^\d+\.\d{2}$/)
    .optional(),
  oldPrice: z
    .string()
    .regex(/^\d+\.\d{2}$/)
    .optional(),
  date: text(20).default(''),
  qr: text(200).default(''),
  currency: z.enum(['SEK', 'NOK', 'DKK', 'EUR']).default('SEK'),
})
export type LabelFacts = z.infer<typeof labelFacts>

/** ZPL field data may not contain ^ or ~ (command prefixes) or control characters. */
export function zplText(input: string) {
  return input
    .replace(/[\^~\\]/g, '')
    .replace(/[^\P{C}]/gu, '')
    .trim()
}

export const labelFormat = z.strictObject({
  widthMm: z.number().min(20).max(120),
  heightMm: z.number().min(15).max(200),
  dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]),
})
export type LabelFormat = z.infer<typeof labelFormat>
/** The layout was drawn for 58 x 40 mm at 203 dpi; other sizes scale it. */
export const referenceFormat: LabelFormat = {
  widthMm: 58,
  heightMm: 40,
  dpi: 203,
}
const REFERENCE_WIDTH = 464
const REFERENCE_HEIGHT = 320

function dots(mm: number, dpi: number) {
  return Math.round((mm / 25.4) * dpi)
}

/** Scaled ZPL primitives for one label size. */
function layout(format: LabelFormat) {
  const width = dots(format.widthMm, format.dpi)
  const height = dots(format.heightMm, format.dpi)
  const s = Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT)
  const n = (value: number) => Math.max(1, Math.round(value * s))
  return {
    frame: (lines: string[]) =>
      ['^XA', '^CI28', `^PW${width}`, `^LL${height}`, ...lines, '^XZ'].join(
        '\n',
      ),
    fd: (x: number, y: number, size: number, value: string) =>
      `^FO${n(x)},${n(y)}^A0N,${n(size)},${n(size)}^FD${zplText(value)}^FS`,
    barcode: (x: number, y: number, value: string) =>
      `^FO${n(x)},${n(y)}^BY${Math.min(4, n(2))},2,${n(60)}^BCN,${n(60)},Y,N,N^FD${zplText(value)}^FS`,
    qrcode: (x: number, y: number, value: string) =>
      `^FO${n(x)},${n(y)}^BQN,2,${Math.min(10, Math.max(2, n(4)))}^FDQA,${zplText(value)}^FS`,
  }
}

/** Renders one label program for the size; the reference is always machine readable. */
export function renderLabel(
  kindInput: unknown,
  factsInput: unknown,
  formatInput: unknown = referenceFormat,
) {
  const kind = labelKind.parse(kindInput)
  const f = labelFacts.parse(factsInput)
  const { frame, fd, barcode, qrcode } = layout(labelFormat.parse(formatInput))
  const price = f.price ? `${f.price} ${f.currency}` : ''
  switch (kind) {
    case 'bag':
      return frame([
        fd(20, 20, 28, f.storeName),
        fd(20, 70, 60, f.reference),
        fd(20, 140, 24, f.line1 || f.date),
        barcode(20, 190, f.reference),
      ])
    case 'garment':
      return frame([
        fd(20, 20, 28, f.storeName),
        fd(20, 70, 60, f.reference),
        fd(20, 140, 24, f.line1 || f.date),
        barcode(20, 190, f.reference),
      ])
    case 'item':
      return frame([
        fd(20, 20, 28, f.storeName),
        fd(20, 60, 24, f.line1),
        fd(20, 95, 24, f.line2),
        fd(20, 140, 56, price),
        fd(20, 210, 22, f.reference),
        barcode(20, 240, f.reference),
      ])
    case 'markdown':
      return frame([
        fd(20, 20, 28, f.storeName),
        fd(20, 60, 24, f.line1),
        fd(20, 100, 28, f.oldPrice ? `${f.oldPrice} ${f.currency}` : ''),
        fd(20, 140, 56, price),
        fd(20, 210, 22, f.reference),
        barcode(20, 240, f.reference),
      ])
    case 'onboarding':
      return frame([
        fd(20, 20, 28, f.storeName),
        fd(20, 60, 24, f.line1),
        fd(20, 95, 22, f.line2),
        qrcode(260, 60, f.qr || f.reference),
        fd(20, 250, 22, f.reference),
      ])
  }
}
