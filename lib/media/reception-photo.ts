export const photoLimit = 3 * 1024 * 1024
function dimensions(width: number, height: number) {
  if (
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 20000000
  )
    throw new Error('INVALID_IMAGE')
}
/** Signature, dimensions and byte bounds, not authenticity or full decoding. */
export function photoType(bytes: Uint8Array) {
  if (bytes.length < 12 || bytes.length > photoLimit)
    throw new Error('INVALID_IMAGE')
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      const length = (bytes[offset] << 8) | bytes[offset + 1]
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        dimensions(
          (bytes[offset + 5] << 8) | bytes[offset + 6],
          (bytes[offset + 3] << 8) | bytes[offset + 4],
        )
        return { mime: 'image/jpeg', ext: 'jpg' }
      }
      offset += length
    }
    throw new Error('INVALID_IMAGE')
  }
  if (
    Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  ) {
    const b = Buffer.from(bytes)
    if (
      b.length < 24 ||
      b.readUInt32BE(8) !== 13 ||
      b.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error('INVALID_IMAGE')
    dimensions(b.readUInt32BE(16), b.readUInt32BE(20))
    return { mime: 'image/png', ext: 'png' }
  }
  throw new Error('INVALID_IMAGE')
}
