import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  MultiFormatReader,
} from '@zxing/library'
import { handoverQr, handoverCodeUrl } from '../../lib/labels/handover-qr'
import { safeNext } from '../../lib/platform/validation'
describe('handover QR', () => {
  it.each([
    { reference: 'H-1', origin: 'https://app.komisio.com', width: 240 },
    {
      reference: 'H-987654321012',
      origin: 'https://app.komisio.com',
      width: 200,
    },
    {
      reference: 'H-1',
      origin: 'https://komisio-staging.vercel.app',
      width: 200,
    },
    {
      reference: 'H-987654321012',
      origin: 'https://komisio-staging.vercel.app',
      width: 240,
    },
  ])(
    'independently decodes $reference at $width pixels on $origin',
    async ({ reference, origin, width }) => {
      const svg = handoverQr(reference, origin)
      const { data, info } = await sharp(Buffer.from(svg))
        .resize({ width })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const decoded = new MultiFormatReader().decode(
        new BinaryBitmap(
          new HybridBinarizer(
            new RGBLuminanceSource(
              new Uint8ClampedArray(data),
              info.width,
              info.height,
            ),
          ),
        ),
      )
      expect(decoded.getText()).toBe(origin + '/scan?ref=' + reference)
      expect(svg).not.toMatch(/<script|<foreignObject|<image|href=/i)
    },
  )
  it.each([
    '',
    'H-0',
    'H-01',
    'H-1234567890123',
    'H-1&next=https://evil.test',
    '<script>',
  ])('rejects invalid payload %s', (reference) =>
    expect(() => handoverQr(reference, 'https://app.komisio.com')).toThrow(
      'INVALID_REFERENCE',
    ),
  )
  it('uses only the configured origin and rejects non-web origins', () => {
    expect(
      handoverCodeUrl('H-1', 'https://example.test/path?token=private'),
    ).toBe('https://example.test/scan?ref=H-1')
    expect(() => handoverCodeUrl('H-1', 'file:///tmp/test')).toThrow(
      'INVALID_ORIGIN',
    )
  })
  it.each([
    '/intake/open',
    '/intake/open?ref=H-12',
    '/intake/open?ref=K-1',
    '/intake/open?ref=G-123',
    '/intake/open?ref=I-ABC123EF',
  ])('preserves the exact safe login destination %s', (value) =>
    expect(safeNext(value)).toBe(value),
  )
  it.each([
    '/intake/open?ref=H-1&next=https://evil.test',
    '/intake/open?ref=H-1#evil',
    '//evil.test/intake/open?ref=H-1',
    '/intake/open?ref=H-1%0aLocation:evil',
    '/intake/open?ref=H-1/extra',
    '/intake/open?ref=H-01',
    '/intake/open?ref=I-abcdefgh',
  ])('rejects extra query/path payload %s', (value) =>
    expect(safeNext(value)).toBe('/'),
  )
})
