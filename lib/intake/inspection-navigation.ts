import { z } from 'zod'

const revision = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number)
  .pipe(z.number().int().max(2147483647))
export const inspectionNavigation = z
  .object({
    draft: z.uuid().optional(),
    version: revision.optional(),
    historyBefore: revision.optional(),
    after: z.uuid().optional(),
    before: z.uuid().optional(),
  })
  .refine(
    (v) =>
      !(v.after && v.before) && (!(v.version || v.historyBefore) || !!v.draft),
  )

// URLs contain identifiers only. Display text never becomes a query expression.
export function inspectionHref(
  params: Record<string, string | number | undefined>,
) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) query.set(key, String(value))
  return `?${query.toString()}`
}
