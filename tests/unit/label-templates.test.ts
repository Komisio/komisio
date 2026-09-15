import { describe, expect, it } from 'vitest'
import {
  builtinTemplate,
  renderStoreTemplate,
  sampleFacts,
} from '../../lib/labels/placeholders'
import { referenceFormat } from '../../lib/labels/templates'

describe('store label templates', () => {
  it('fills placeholders with sanitised values and keeps UTF-8 on', () => {
    const zpl = renderStoreTemplate(
      '^XA^FO10,10^A0N,30,30^FD{store}^FS^FO10,50^BCN,60,Y,N,N^FD{reference}^FS^FD{price}^FS^FD{unknown}^FS^XZ',
      {
        storeName: 'Evil^XZ~JR store',
        reference: 'I-1A2B3C4D',
        price: '250.00',
        currency: 'SEK',
      },
      referenceFormat,
    )
    expect(zpl.startsWith('^XA^CI28')).toBe(true)
    expect(zpl).toContain('^FDEvilXZJR store^FS')
    expect(zpl).toContain('^FDI-1A2B3C4D^FS')
    expect(zpl).toContain('^FD250.00 SEK^FS')
    expect(zpl).toContain('^FD^FS')
    expect(zpl).not.toContain('~JR')
  })
  it('exposes the label size in dots for templates that set their own frame', () => {
    const zpl = renderStoreTemplate(
      '^XA^PW{width}^LL{height}^FD{reference}^FS^XZ',
      { storeName: 'S', reference: 'K-1' },
      { widthMm: 76, heightMm: 51, dpi: 203 },
    )
    expect(zpl).toContain('^PW607')
    expect(zpl).toContain('^LL408')
  })
  it('offers the built-in layout with placeholders as a starting point', () => {
    const item = builtinTemplate('item', referenceFormat)
    expect(item).toContain('^FD{store}^FS')
    expect(item).toContain('^FD{price}^FS')
    expect(item).toContain('^FD{reference}^FS')
    expect(item).not.toContain('0.01')
    const markdown = builtinTemplate('markdown', referenceFormat)
    expect(markdown).toContain('^FD{oldPrice}^FS')
    expect(markdown).toContain('^FD{price}^FS')
    const filled = renderStoreTemplate(
      item,
      sampleFacts('item'),
      referenceFormat,
    )
    expect(filled).toContain('^FDButiken^FS')
    expect(filled).toContain('^FD250.00 SEK^FS')
  })
})
