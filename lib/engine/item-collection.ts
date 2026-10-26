import { z } from 'zod'
import type { readItem } from './items'

export const recordItemCollectionCommand = z.strictObject({
  action: z.literal('recordItemCollection'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  itemId: z.guid(),
  endEventId: z.uuid(),
  expectedCurrentId: z.uuid().nullable(),
  collected: z.boolean(),
  observedOn: z.iso.date(),
  note: z.string().trim().max(500).default(''),
})

export const itemCollectionDetail = z.object({
  endEventId: z.uuid(),
  collected: z.boolean(),
  observedOn: z.iso.date(),
  note: z.string(),
})
export type ItemCollectionDetail = z.infer<typeof itemCollectionDetail>

/** Events arrive oldest first from the scoped item-detail read. */
export function itemCollectionState(
  events: NonNullable<Awaited<ReturnType<typeof readItem>>>['events'],
) {
  const end = events.findLast((event) => event.kind === 'period_ended')
  if (!end || end.detail.action !== 'return') return null
  const latest = events.findLast(
    (event) =>
      event.kind === 'collection_recorded' &&
      event.detail.endEventId === end.id,
  )
  return {
    endEventId: end.id,
    current: latest
      ? { id: latest.id, ...itemCollectionDetail.parse(latest.detail) }
      : null,
  }
}
