import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
const summary = z.object({
  accepted: z.number().int().nonnegative(),
  drafts: z.number().int().nonnegative(),
  receptions: z.number().int().nonnegative(),
  // Existing row ids: readers accept any GUID shape, as the other bag readers do.
  nextDraft: z.guid().nullable(),
  nextReception: z.guid().nullable(),
})

/**
 * Whether a read failed for a reason that says nothing about the caller's
 * rights or input: the function is not deployed yet, the connection or the
 * database was unavailable, the statement timed out, or the request never
 * reached PostgREST. Authorization (42501), raised business errors (P0001)
 * and validation stay failures and are never turned into "no work".
 */
export function isTransientReadError(error: {
  code?: string | null
  message?: string
}) {
  const code = error.code ?? ''
  if (code === 'PGRST202') return true
  if (/^PGRST00[0-2]$/.test(code)) return true
  if (/^(08|53|57)/.test(code)) return true
  if (code === '40001' || code === '40P01') return true
  // supabase-js reports a failed fetch without a SQLSTATE or PostgREST code.
  return (
    code === '' &&
    /fetch failed|network|ECONN|ETIMEDOUT/i.test(error.message ?? '')
  )
}

/** Null means "unavailable right now"; the caller shows that, never a zero. */
export async function readBagWorkSummary(
  client: SupabaseClient,
  tenant: string,
  bag: string,
) {
  const result = await client.rpc('bag_work_summary', {
    p_tenant: z.uuid().parse(tenant),
    p_bag: z.uuid().parse(bag),
  })
  if (result.error) {
    if (isTransientReadError(result.error)) return null
    throw new Error('Unable to read handover progress')
  }
  return summary.parse(result.data)
}
