import { inspectionReadOptions } from '../engine/inspection-read'
import { z } from 'zod'

const revision = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number)
  .pipe(z.number().int().max(2147483647))
export const inspectionNavigation = z
  .object({
    status: z.enum(['active', 'archived', 'all']).optional(),
    draft: z.uuid().optional(),
    version: revision.optional(),
    historyBefore: revision.optional(),
    after: z.uuid().optional(),
    before: z.uuid().optional(),
  })
  .pipe(inspectionReadOptions)

// URLs contain identifiers only. Display text never becomes a query expression.
export function inspectionHref(
  params: Record<string, string | number | undefined>,
) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) query.set(key, String(value))
  return `?${query.toString()}`
}
