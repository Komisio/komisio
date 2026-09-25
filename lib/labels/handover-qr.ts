import { toSVG } from '@bwip-js/generic'
/** Same-application staff lookup; the code contains no seller details or authorization. */
export function handoverCodeUrl(reference: string, appUrl: string) {
  if (!/^H-[1-9]\d{0,11}$/.test(reference)) throw new Error('INVALID_REFERENCE')
  const base = new URL(appUrl)
  if (!['https:', 'http:'].includes(base.protocol))
    throw new Error('INVALID_ORIGIN')
  const url = new URL('/scan', base.origin)
  url.searchParams.set('ref', reference)
  return url.toString()
}
export function handoverQr(reference: string, appUrl: string) {
  return toSVG({
    bcid: 'qrcode',
    text: handoverCodeUrl(reference, appUrl),
    eclevel: 'M',
    scale: 4,
    // BWIP uses two base pixels per module: eight padding units give four modules.
    padding: 8,
    backgroundcolor: 'FFFFFF',
  })
}
