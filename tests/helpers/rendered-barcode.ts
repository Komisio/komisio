import sharp from 'sharp'
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library'

/**
 * Decode a Code 128 from a screenshot exactly as captured: the pixels are
 * converted to grey, never resized or redrawn, so the result says whether the
 * image the browser actually shows carries the reference.
 */
export async function decodeRenderedCode128(png: Buffer) {
  const { data, info } = await sharp(png)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128])
  hints.set(DecodeHintType.TRY_HARDER, true)
  const reader = new MultiFormatReader()
  reader.setHints(hints)
  const text = reader
    .decode(
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
    .getText()
  return { text, width: info.width, height: info.height }
}
