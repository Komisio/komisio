import { z } from 'zod'
import type { readItem } from './items'

const ids = {
  tenantId: z.uuid(),
  requestId: z.uuid(),
  itemId: z.guid(),
  expectedEndEventId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
}
export const reopenItemPeriodCommand = z.strictObject({
  action: z.literal('reopenItemPeriod'),
  ...ids,
  saleEndsOn: z.iso.date(),
})
export const correctItemPeriodEndCommand = z.strictObject({
  action: z.literal('correctItemPeriodEnd'),
  ...ids,
  endAction: z.enum(['charity', 'return', 'recycle']),
})

/** The authorized item stream is ordered from oldest to newest by the engine. */
export function currentItemEnd(
  events: NonNullable<Awaited<ReturnType<typeof readItem>>>['events'],
) {
  const event = events.findLast((e) =>
    ['period_ended', 'period_end_corrected', 'period_reopened'].includes(
      e.kind,
    ),
  )
  return event && event.kind !== 'period_reopened' ? event : null
}
