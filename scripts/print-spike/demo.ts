import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { renderSingleLabelPages } from './label-pdf'

const output = resolve('private/print-spike')
await mkdir(output, { recursive: true })
const attributes = [
  ['brand', 'Brand', 'Example'],
  ['size', 'Size', 'M'],
  ['colour', 'Colour', 'Blue'],
  ['material', 'Material', 'Wool'],
].map(([slug, name, value]) => ({
  slug,
  value,
  labels: { en: name },
  dataType: 'text',
  unit: '',
  choices: [],
}))
for (const [widthMm, heightMm] of [
  [57, 32],
  [76, 51],
  [62, 32],
]) {
  const pdf = await renderSingleLabelPages({
    storeName: 'Synthetic store',
    items: [
      {
        id: '30300000-0000-4000-8000-000000000001',
        reference: 'I-30300000',
        title: 'Blue wool jacket ÅÄÖ',
        priceOre: '12345',
        currency: 'SEK',
        attributes,
      },
    ],
    widthMm,
    heightMm,
    copies: 1,
    locale: 'en',
  })
  const path = resolve(output, `label-${widthMm}x${heightMm}.pdf`)
  await writeFile(path, pdf)
  console.log(path)
}
