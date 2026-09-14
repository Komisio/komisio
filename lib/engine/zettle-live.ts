import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  connectedPilotClient,
  pilotAvailable,
  pilotEnvironment,
  verifyPilotConnection,
  type PilotEnvironment,
} from '../../extensions/zettle/auth'
import { mapZettlePage } from '../../extensions/zettle/purchase'
import { readStoreCurrency } from './money'
import type { ZettleTransport } from '../../extensions/zettle/transport'
async function authorize(
  client: SupabaseClient,
  tenantId: string,
  source: PilotEnvironment,
) {
  z.uuid().parse(tenantId)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (role.error || !['owner', 'admin'].includes(role.data ?? ''))
    throw new Error('FORBIDDEN')
  const env = pilotEnvironment(source)
  if (!pilotAvailable(tenantId, env) || !env.ZETTLE_MERCHANT_ID)
    throw new Error('ZETTLE_NOT_CONNECTED')
  return env
}
export async function enableZettlePull(
  client: SupabaseClient,
  tenantId: string,
  source: PilotEnvironment,
  http?: typeof fetch,
) {
  const env = await authorize(client, tenantId, source)
  await verifyPilotConnection(tenantId, env, http)
  const r = await client.rpc('enable_zettle_pull', {
    p_tenant: tenantId,
    p_merchant: env.ZETTLE_MERCHANT_ID,
  })
  if (r.error) throw new Error(r.error.message)
  return r.data as string
}
export async function readZettlePull(client: SupabaseClient, tenantId: string) {
  const [c, w] = await Promise.all([
    client
      .from('zettle_pull_connections')
      .select('merchant_id,cutover')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    client
      .from('zettle_pull_windows')
      .select('id,start_at,end_at')
      .eq('tenant_id', tenantId)
      .order('seq', { ascending: false })
      .limit(1),
  ])
  if (c.error || w.error) throw new Error('ZETTLE_READ_FAILED')
  const window = w.data?.[0] ?? null
  const page = window
    ? await client
        .from('zettle_pull_pages')
        .select('id,purchase_count,cursor_after')
        .eq('tenant_id', tenantId)
        .eq('window_id', window.id)
        .order('seq', { ascending: false })
        .limit(1)
    : null
  if (page?.error) throw new Error('ZETTLE_READ_FAILED')
  return { connection: c.data, window, page: page?.data?.[0] ?? null }
}
export async function readZettleWindowClosure(
  client: SupabaseClient,
  tenantId: string,
  windowId: string,
) {
  const result = await client.rpc('zettle_window_closure', {
    p_tenant: z.uuid().parse(tenantId),
    p_window: z.uuid().parse(windowId),
  })
  if (result.error?.code === 'PGRST202')
    return { available: false, closure: null }
  if (result.error) throw new Error('ZETTLE_READ_FAILED')
  return {
    available: true,
    closure: z
      .object({
        id: z.uuid(),
        reason: z.string().min(1).max(500),
        createdAt: z.string(),
      })
      .nullable()
      .parse(result.data),
  }
}

export async function abandonZettleWindow(
  client: SupabaseClient,
  tenantId: string,
  requestId: string,
  windowId: string,
  reason: string,
) {
  const result = await client.rpc('abandon_zettle_pull_window', {
    p_tenant: z.uuid().parse(tenantId),
    p_id: z.uuid().parse(requestId),
    p_window: z.uuid().parse(windowId),
    p_reason: z.string().trim().min(1).max(500).parse(reason),
  })
  if (result.error) throw new Error(result.error.message)
  return { id: z.uuid().parse(result.data) }
}

type Factory = (
  tenantId: string,
  env: PilotEnvironment,
  window: { startDate: string; endDate: string },
) => Promise<ZettleTransport>
/** One durable provider page per invocation; DB reconciliation is the sole financial writer. */
export async function pullZettlePurchases(
  client: SupabaseClient,
  tenantId: string,
  requestId: string,
  source: PilotEnvironment,
  factory: Factory = connectedPilotClient,
) {
  z.uuid().parse(requestId)
  const env = await authorize(client, tenantId, source)
  const state = await readZettlePull(client, tenantId)
  if (
    !state.connection ||
    state.connection.merchant_id !== env.ZETTLE_MERCHANT_ID
  )
    throw new Error('ZETTLE_NOT_CONNECTED')
  const prior = await client
    .from('zettle_pull_pages')
    .select('window_id,cursor_before,cursor_after')
    .eq('tenant_id', tenantId)
    .eq('id', requestId)
    .maybeSingle()
  if (prior.error) throw new Error('ZETTLE_READ_FAILED')
  if (prior.data) {
    const run = await client
      .from('zettle_sync_runs')
      .select('page')
      .eq('tenant_id', tenantId)
      .eq('id', requestId)
      .single()
    if (run.error) throw new Error('ZETTLE_READ_FAILED')
    const replay = await client.rpc('record_zettle_pull_page', {
      p_tenant: tenantId,
      p_id: requestId,
      p_window: prior.data.window_id,
      p_before: prior.data.cursor_before,
      p_after: prior.data.cursor_after,
      p_purchases: run.data.page,
    })
    if (replay.error) throw new Error(replay.error.message)
    return { id: requestId, replayed: true }
  }
  const opened = await client.rpc('open_zettle_pull_window', {
    p_tenant: tenantId,
    p_merchant: env.ZETTLE_MERCHANT_ID,
  })
  if (opened.error) throw new Error(opened.error.message)
  if (!opened.data) return { id: requestId, waiting: true }
  const window = await client
    .from('zettle_pull_windows')
    .select('start_at,end_at')
    .eq('tenant_id', tenantId)
    .eq('id', opened.data)
    .single()
  const latest = await client
    .from('zettle_pull_pages')
    .select('cursor_after,purchase_count')
    .eq('tenant_id', tenantId)
    .eq('window_id', opened.data)
    .order('seq', { ascending: false })
    .limit(1)
  if (window.error || latest.error) throw new Error('ZETTLE_READ_FAILED')
  if (latest.data?.[0]?.purchase_count === 0)
    throw new Error('ZETTLE_WINDOW_COMPLETE')
  const transport = await factory(tenantId, env, {
    startDate: new Date(window.data.start_at).toISOString(),
    endDate: new Date(window.data.end_at).toISOString(),
  })
  const before = latest.data?.[0]?.cursor_after ?? null
  const currency = await readStoreCurrency(client, tenantId)
  const page = mapZettlePage(
    await transport.fetchPage({
      cursor: before,
      signal: AbortSignal.timeout(15000),
    }),
    before,
    currency,
  )
  const result = await client.rpc('record_zettle_pull_page', {
    p_tenant: tenantId,
    p_id: requestId,
    p_window: opened.data,
    p_before: before,
    p_after: page.nextCursor,
    p_purchases: page.purchases,
  })
  if (result.error) throw new Error(result.error.message)
  return {
    id: requestId,
    received: page.purchases.length,
    complete: page.purchases.length === 0,
  }
}
