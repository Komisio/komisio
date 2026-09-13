import { z } from 'zod'

// Label templates (P2 S19): ZPL as versioned code with fixed layout and
// plain-text placeholders. Every dynamic value is stripped of ZPL control
// characters so a store name or a note can never change the label program.
export const LABEL_TEMPLATE_VERSION = 'zpl-v1'
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
})
export type LabelFacts = z.infer<typeof labelFacts>

/** ZPL field data may not contain ^ or ~ (command prefixes) or control characters. */
export function zplText(input: string) {
  return input
    .replace(/[\^~\\]/g, '')
    .replace(/[^\P{C}]/gu, '')
    .trim()
}

/** A 58 mm label at 203 dpi is about 464 dots wide; layouts stay inside 440. */
function frame(lines: string[]) {
  return ['^XA', '^CI28', '^PW464', '^LL320', ...lines, '^XZ'].join('\n')
}
const fd = (x: number, y: number, size: number, value: string) =>
  `^FO${x},${y}^A0N,${size},${size}^FD${zplText(value)}^FS`
const barcode = (x: number, y: number, value: string) =>
  `^FO${x},${y}^BY2,2,60^BCN,60,Y,N,N^FD${zplText(value)}^FS`
const qrcode = (x: number, y: number, value: string) =>
  `^FO${x},${y}^BQN,2,4^FDQA,${zplText(value)}^FS`

/** Renders one label program. The reference is always machine readable. */
export function renderLabel(kindInput: unknown, factsInput: unknown) {
  const kind = labelKind.parse(kindInput)
  const f = labelFacts.parse(factsInput)
  const price = f.price ? `${f.price} SEK` : ''
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
        fd(20, 100, 28, f.oldPrice ? `${f.oldPrice} SEK` : ''),
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
