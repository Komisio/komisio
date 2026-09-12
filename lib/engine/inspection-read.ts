import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { inspectionFields } from './inspection'

const revision = z.number().int().min(1).max(2147483647)
export const inspectionReadOptions = z
  .strictObject({
    status: z.enum(['active', 'archived', 'all']).default('active'),
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
export const inspectionReadInput = inspectionReadOptions.safeExtend({
  bagId: z.uuid(),
})
const historyRow = z.object({
  revision,
  saved_at: z.iso.datetime({ offset: true }),
  archived: z.boolean(),
  change_reason: z.string(),
})
const savedRow = historyRow.extend({
  draft_id: z.uuid(),
  ...inspectionFields.shape,
})
function unavailable(): never {
  throw new Error('INSPECTION_UNAVAILABLE')
}

/** Shared bounded staff read; database RLS/MFA remains authoritative. */
export async function readInspection(
  client: SupabaseClient,
  tenantInput: string,
  input: unknown,
) {
  const tenantId = z.uuid().parse(tenantInput)
  const {
    bagId: id,
    draft,
    version,
    historyBefore,
    after,
    before,
    status,
  } = inspectionReadInput.parse(input)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (
    role.error ||
    !['owner', 'admin', 'staff', 'readonly'].includes(role.data)
  )
    throw new Error('FORBIDDEN')
  const { data: bag, error } = await client
    .from('bag_receipts')
    .select('reference,note')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Unable to load inspection bag')
  if (!bag) unavailable()
  const columns =
    'draft_id,revision,description,category,condition,saved_at,archived,change_reason'
  let listQuery = client
    .from('inspection_current')
    .select(columns)
    .eq('tenant_id', tenantId)
    .eq('bag_id', id)
    .order('draft_id', { ascending: !before })
    .limit(21)
  if (status !== 'all')
    listQuery = listQuery.eq('archived', status === 'archived')
  if (after) listQuery = listQuery.gt('draft_id', after)
  if (before) listQuery = listQuery.lt('draft_id', before)
  const [list, selected] = await Promise.all([
    listQuery,
    draft
      ? client
          .from('inspection_current')
          .select(columns)
          .eq('tenant_id', tenantId)
          .eq('bag_id', id)
          .eq('draft_id', draft)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (list.error || selected.error)
    throw new Error('Unable to load inspection drafts')
  if (draft && !selected.data) unavailable()
  const extra = (list.data?.length ?? 0) > 20
  const parsedList = z
    .array(savedRow)
    .max(21)
    .parse(list.data ?? [])
  const items = parsedList.slice(0, 20)
  if (before) items.reverse()
  const hasPrevious = before ? extra : !!after
  const hasNext = before ? true : extra
  const [history, historical] = await Promise.all([
    draft
      ? client
          .from('inspection_draft_revisions')
          .select('revision,saved_at,archived,change_reason')
          .eq('tenant_id', tenantId)
          .eq('bag_id', id)
          .eq('draft_id', draft)
          .lte(
            'revision',
            Math.min(
              selected.data!.revision,
              historyBefore ? historyBefore - 1 : 2147483647,
            ),
          )
          .order('revision', { ascending: false })
          .limit(21)
      : Promise.resolve({ data: null, error: null }),
    version
      ? client
          .from('inspection_draft_revisions')
          .select(columns)
          .eq('tenant_id', tenantId)
          .eq('bag_id', id)
          .eq('draft_id', draft!)
          .eq('revision', version)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (history.error || historical.error)
    throw new Error('Unable to load inspection history')
  if (version && !historical.data) unavailable()
  const parsedHistory = z
    .array(historyRow)
    .max(21)
    .parse(history.data ?? [])
  const past = parsedHistory.slice(0, 20)
  return {
    readOnly: true as const,
    evidenceIsUntrusted: true as const,
    availableForSale: false as const,
    bagId: id,
    bag: z
      .object({
        reference: z.union([z.string(), z.number()]),
        note: z.string(),
      })
      .parse(bag),
    items,
    selected: selected.data ? savedRow.parse(selected.data) : null,
    historical: historical.data ? savedRow.parse(historical.data) : null,
    past,
    historyHasMore: parsedHistory.length > 20,
    hasPrevious,
    hasNext,
    nextAfter: hasNext ? (items.at(-1)?.draft_id ?? null) : null,
    nextBefore: hasPrevious ? (items[0]?.draft_id ?? null) : null,
    nextHistoryBefore: parsedHistory.length > 20 ? past.at(-1)!.revision : null,
  }
}
