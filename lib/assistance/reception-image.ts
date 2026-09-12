import sharp from 'sharp'
import { photoType } from '../engine/reception-photos'
/** Private originals never leave storage; send a bounded derivative with no EXIF/XMP. */
export async function receptionImage(bytes: Uint8Array) {
  photoType(bytes)
  const data = await sharp(Buffer.from(bytes), {
    limitInputPixels: 20000000,
    autoOrient: true,
    failOn: 'warning',
  })
    .resize({
      width: 1536,
      height: 1536,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .timeout({ seconds: 5 })
    .toBuffer()
  if (data.length > 1024 * 1024) throw new Error('ASSISTANCE_IMAGE_TOO_LARGE')
  return `data:image/jpeg;base64,${data.toString('base64')}`
}
