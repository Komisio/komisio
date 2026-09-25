import { toSVG } from '@bwip-js/generic'

/** Server-rendered Code 128. Only the existing item reference enters the SVG. */
export function itemBarcode(reference: string) {
  if (!/^I-[0-9A-F]{8}$/.test(reference)) throw new Error('INVALID_REFERENCE')
  return toSVG({
    bcid: 'code128',
    text: reference,
    scale: 3,
    height: 12,
    paddingwidth: 10,
    paddingheight: 2,
    backgroundcolor: 'FFFFFF',
    includetext: false,
  })
}
