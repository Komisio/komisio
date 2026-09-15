import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Stages are derived in SQL from the store policy (delegated or per_item),
// custody, the seller response and the accepted item. Nothing here decides.
export const receptionStage = z.enum([
  'preparing',
  'needs_review',
  'awaiting_custody',
  'ready_to_accept',
  'accepted',
  'declined',
  'expired',
  'ready_to_share',
  'link_revoked',
  'awaiting_seller',
])
// Guidance only: these codes never authorize or execute a transition.
const nextStep = {
  preparing: 'prepare_evidence',
  needs_review: 'review_changed_evidence',
  awaiting_custody: 'record_custody',
  ready_to_accept: 'accept_item',
  accepted: 'item_accepted',
  declined: 'review_seller_decline',
  expired: 'publish_fresh_review',
  ready_to_share: 'issue_review_link',
  link_revoked: 'replace_review_link',
  awaiting_seller: 'await_seller_response',
} as const satisfies Record<z.infer<typeof receptionStage>, string>
export const receptionQueueInput = z
  .object({
    tenantId: z.uuid(),
    stage: receptionStage.optional(),
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.uuid().optional(),
  })
  .refine(
    (v) => Boolean(v.before) === Boolean(v.beforeId),
    'Both cursor fields are required',
  )
const row = z.object({
  session_id: z.guid(),
  seller_name: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  source_revision: z.number().int().nonnegative(),
  review_id: z.guid().nullable(),
  review_version: z.number().int().positive().nullable(),
  decision: z.enum(['approve', 'decline']).nullable(),
  responded_at: z.iso.datetime({ offset: true }).nullable(),
  stage: receptionStage,
  link_state: z.enum(['none', 'active', 'revoked', 'expired', 'stale']),
})
/** Staff-only read; database derives current-version state and enforces RLS/MFA. */
export async function readReceptionQueue(
  client: SupabaseClient,
  input: z.input<typeof receptionQueueInput>,
) {
  const p = receptionQueueInput.parse(input)
  const { data, error } = await client.rpc('reception_queue', {
    p_tenant: p.tenantId,
    p_stage: p.stage ?? null,
    p_before: p.before ?? null,
    p_before_id: p.beforeId ?? null,
  })
  if (error) throw new Error('Unable to read reception queue')
  const rows = z.array(row).max(21).parse(data)
  const items = rows.slice(0, 20).map((item) => ({
    ...item,
    nextStep: nextStep[item.stage],
    guidanceOnly: true as const,
  }))
  const last = items.at(-1)
  return {
    items,
    next:
      rows.length > 20 && last
        ? { before: last.created_at, beforeId: last.session_id }
        : null,
  }
}
