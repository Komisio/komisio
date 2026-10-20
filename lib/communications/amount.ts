import { z } from 'zod'

const minorUnits = z
  .union([
    z.number().int().refine(Number.isSafeInteger),
    z.string().regex(/^-?\d+$/),
  ])
  .transform((value) => BigInt(value))

/** Exact display input for Intl; database bigints never pass through Number. */
export function emailDecimalAmount(value: unknown) {
  const minor = minorUnits.parse(value)
  const absolute = minor < 0n ? -minor : minor
  return `${minor < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}
