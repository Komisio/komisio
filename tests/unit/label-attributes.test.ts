import { expect, it } from 'vitest'
import { labelAttributeLines } from '../../lib/labels/item-attributes'
import { renderLabel } from '../../lib/labels/templates'
import { renderStoreTemplate } from '../../lib/labels/placeholders'
const attribute = {
  slug: 'colour',
  value: 'blue',
  labels: { sv: 'Färg', en: 'Colour' },
  dataType: 'choice',
  unit: '',
  choices: [{ id: 'blue', labels: { sv: 'Blå', en: 'Blue' } }],
}
it('localizes custom labels, choices, booleans and units without invented attributes', () => {
  const facts = [
    attribute,
    {
      ...attribute,
      slug: 'height',
      value: '42',
      labels: { en: 'Height' },
      choices: [],
      dataType: 'number',
      unit: 'cm',
    },
    {
      ...attribute,
      slug: 'adjustable',
      value: 'false',
      dataType: 'boolean',
      labels: { en: 'Adjustable' },
      choices: [],
    },
    {
      ...attribute,
      slug: 'size',
      value: 'M',
      dataType: 'text',
      labels: { en: 'Size' },
      choices: [],
    },
  ]
  expect(labelAttributeLines(facts, 'sv')).toEqual([
    'Färg: Blå',
    'Height: 42 cm',
    'Adjustable: Nej',
    'Size: M',
  ])
  expect(labelAttributeLines(facts, 'en')[0]).toBe('Colour: Blue')
  expect(
    labelAttributeLines([{ ...attribute, value: '' }, ...facts, attribute]),
  ).toHaveLength(4)
  expect(labelAttributeLines()).toEqual([])
})
it('includes four sanitized attributes on item and markdown Zebra labels', () => {
  for (const kind of ['item', 'markdown']) {
    const payload = renderLabel(kind, {
      storeName: 'Synthetic',
      reference: 'I-12345678',
      line1: 'Current title',
      price: '100.00',
      oldPrice: '120.00',
      attributes: [
        'Brand: Example',
        'Size: M',
        'Colour: Blue',
        'Material: ^XZ~JR Wool',
      ],
    })
    for (const part of [
      'Brand: Example',
      'Size: M',
      'Colour: Blue',
      'Material: XZJR Wool',
      'I-12345678',
      '100.00',
    ])
      expect(payload).toContain(part)
    expect(payload.match(/\^XZ/g)).toHaveLength(1)
    expect(payload).not.toContain('~JR')
    if (kind === 'markdown') expect(payload).toContain('120.00')
  }
})
it('allows custom templates to opt in without rewriting saved layouts', () => {
  const facts = {
    storeName: 'Synthetic',
    reference: 'I-12345678',
    attributes: ['One', 'Two', 'Three', 'Four'],
  }
  expect(
    renderStoreTemplate(
      '^XA^FD{attribute1}|{attribute2}|{attribute3}|{attribute4}^FS^XZ',
      facts,
    ),
  ).toContain('One|Two|Three|Four')
  expect(renderStoreTemplate('^XA^FD{reference}^FS^XZ', facts)).not.toContain(
    'One',
  )
})
