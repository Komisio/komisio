import { rateBasisPointsFromPercent } from './vat'

export function compareZettleVat(value: string, engineBasisPoints: number) {
  if (value.trim() === '') return 'unmapped'
  try {
    return rateBasisPointsFromPercent(Number(value)) === engineBasisPoints
      ? 'match'
      : 'mismatch'
  } catch {
    return 'invalid'
  }
}
