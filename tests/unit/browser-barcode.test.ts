import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  MultiFormatReader,
} from '@zxing/library'
import { itemBarcode } from '../../lib/labels/browser-barcode'

describe('browser item barcode', () => {
  it.each(['I-00000000', 'I-FFFFFFFF', 'I-ABC123EF', 'I-12345678'])(
    'independently decodes %s at printed label width',
    async (reference) => {
      const svg = itemBarcode(reference)
      // Approximate a 72 mm barcode area at 203 dpi, including its quiet zones.
      const { data, info } = await sharp(Buffer.from(svg))
        .resize({ width: 575 })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const luminance = new RGBLuminanceSource(
        new Uint8ClampedArray(data),
        info.width,
        info.height,
      )
      const decoded = new MultiFormatReader().decode(
        new BinaryBitmap(new HybridBinarizer(luminance)),
      )
      expect(decoded.getText()).toBe(reference)
      expect(svg).not.toMatch(/<script|<foreignObject|<image|href=/i)
    },
  )
  it.each([
    '',
    'I-abcdef12',
    'G-ABC123EF',
    'I-ABC123EF<script>',
    'I-123456789',
  ])('rejects noncanonical input %s', (input) => {
    expect(() => itemBarcode(input)).toThrow('INVALID_REFERENCE')
  })
})
