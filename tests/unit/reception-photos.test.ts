import { it, expect } from 'vitest'
import { photoType, photoLimit } from '../../lib/engine/reception-photos'
it('rejects unsupported bytes and oversized images independently of MIME claims', () => {
  expect(() =>
    photoType(Buffer.from('<svg>not a supported image</svg>')),
  ).toThrow()
  expect(() => photoType(new Uint8Array(photoLimit + 1))).toThrow()
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001',
    'hex',
  )
  expect(photoType(png).ext).toBe('png')
  png.writeUInt32BE(100000, 16)
  expect(() => photoType(png)).toThrow()
  expect(
    photoType(Buffer.from('ffd8ffc00008080001000100ffd9', 'hex')).ext,
  ).toBe('jpg')
  expect(() =>
    photoType(Buffer.from('ffd8ff000000000000000000', 'hex')),
  ).toThrow()
})
