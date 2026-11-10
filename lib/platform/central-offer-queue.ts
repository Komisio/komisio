import type { SupabaseClient } from '@supabase/supabase-js'
import { externalItemsEnabled } from './mobile-external-items'

/** A navigation hint only; queue and commands separately enforce tenant RLS. */
export async function centralOfferQueueVisible(
  client: SupabaseClient,
  tenant: string,
) {
  if (!externalItemsEnabled()) return false
  const r = await client.rpc('public_central_app_recipient')
  // An unavailable optional recipient must not break existing store workspaces.
  if (!r.error && r.data?.id === tenant) return true
  // Pausing new intake or selecting a new recipient must not hide saved work.
  // RLS still limits this optional history lookup to the current store.
  const history = await client
    .from('external_item_requests')
    .select('id')
    .eq('tenant_id', tenant)
    .limit(1)
  return !history.error && !!history.data?.length
}
