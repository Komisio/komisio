import { z } from 'zod'
import {
  labelFacts,
  labelFormat,
  labelKind,
  referenceFormat,
  renderLabel,
  zplText,
  type LabelFormat,
  type LabelKind,
} from './templates'

// Store templates (the ZPL editor): the store writes the program with
// placeholders; every value is sanitised with zplText before it enters the
// program, so a placeholder can never carry a command. Unknown placeholders
// render empty. The built-in layout is available as a template with
// placeholders, so a store starts from what it already prints.
export const placeholders = [
  'store',
  'reference',
  'line1',
  'line2',
  'price',
  'oldPrice',
  'currency',
  'date',
  'qr',
  'title',
  'category',
  'width',
  'height',
] as const
export type Placeholder = (typeof placeholders)[number]

const storeTemplate = z.string().min(4).max(20000)

function dots(mm: number, dpi: number) {
  return Math.round((mm / 25.4) * dpi)
}

/** Fills a store template. The program keeps ^CI28 after ^XA so Swedish letters print. */
export function renderStoreTemplate(
  zplInput: unknown,
  factsInput: unknown,
  formatInput: unknown = referenceFormat,
) {
  const zpl = storeTemplate.parse(zplInput)
  const f = labelFacts.parse(factsInput)
  const format = labelFormat.parse(formatInput)
  const values: Record<Placeholder, string> = {
    store: f.storeName,
    reference: f.reference,
    line1: f.line1,
    line2: f.line2,
    price: f.price ? `${f.price} ${f.currency}` : '',
    oldPrice: f.oldPrice ? `${f.oldPrice} ${f.currency}` : '',
    currency: f.currency,
    date: f.date,
    qr: f.qr || f.reference,
    title: f.line1,
    category: f.line2,
    width: String(dots(format.widthMm, format.dpi)),
    height: String(dots(format.heightMm, format.dpi)),
  }
  const filled = zpl.replace(/\{([A-Za-z0-9]+)\}/g, (_m, name: string) =>
    zplText(values[name as Placeholder] ?? ''),
  )
  return filled.startsWith('^XA^CI28')
    ? filled
    : filled.replace(/^\^XA/, '^XA^CI28')
}

/** The built-in layout for a kind and size, with placeholders instead of values: the editor's starting point. */
export function builtinTemplate(
  kindInput: unknown,
  formatInput: unknown = referenceFormat,
) {
  const kind = labelKind.parse(kindInput)
  const marker = (name: Placeholder) => `{${name}}`
  // Prices must be decimals for the layout; sentinel amounts become the markers afterwards.
  const facts = {
    storeName: marker('store'),
    reference: marker('reference'),
    line1: marker('line1'),
    line2: marker('line2'),
    price: '0.01',
    oldPrice: '0.02',
    date: marker('date'),
    qr: marker('qr'),
    currency: 'SEK',
  }
  return renderLabel(kind, facts, formatInput)
    .replace('^FD0.01 SEK^FS', `^FD${marker('price')}^FS`)
    .replace('^FD0.02 SEK^FS', `^FD${marker('oldPrice')}^FS`)
}

/** Sample facts for a preview, never real data. */
export function sampleFacts(kind: LabelKind, currency = 'SEK') {
  const base = {
    storeName: 'Butiken',
    reference: kind === 'onboarding' ? 'S-1A2B3C4D' : 'I-1A2B3C4D',
    date: '2026-09-15',
    currency,
  }
  switch (kind) {
    case 'bag':
      return { ...base, reference: 'K-12', line1: '2026-09-15' }
    case 'garment':
      return { ...base, reference: 'G-7', line1: '2026-09-15' }
    case 'item':
      return { ...base, line1: 'Blå jacka', line2: 'Jackor', price: '250.00' }
    case 'markdown':
      return {
        ...base,
        line1: 'Blå jacka',
        price: '200.00',
        oldPrice: '250.00',
      }
    case 'onboarding':
      return {
        ...base,
        line1: 'Anna Andersson',
        line2: 'Inlämnare',
        qr: 'https://example.test/intake/sellers/x',
      }
  }
}

export type { LabelFormat }
