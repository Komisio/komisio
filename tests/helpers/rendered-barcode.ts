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
  // decode(image, hints) replaces any state set earlier with setHints, so the
  // hints must travel with the call to take effect.
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128])
  hints.set(DecodeHintType.TRY_HARDER, true)
  const text = new MultiFormatReader()
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
      hints,
    )
    .getText()
  return { text, width: info.width, height: info.height }
}
