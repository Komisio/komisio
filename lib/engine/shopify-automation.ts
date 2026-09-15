import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { automationIdentity, acceptAutomationGrants } from './automation'
import { pullShopifyOrders } from './shopify-orders'

// Scheduled order pull (scope shopify_pull): the automation identity
// reserves one run per store and quarter hour, pulls one page through the
// same engine function the button uses, and ends the run in one of three
// fixed outcomes. Provider errors never reach the audit trail.
const job = z.object({ id: z.guid(), cursor: z.string().nullable() })
export const automaticPullStatus = z.object({
  id: z.guid(),
  at: z.string(),
  outcome: z.enum(['started', 'received', 'complete', 'failed']),
  received: z.number().int().min(0).max(50),
})

export async function readShopifyAutomaticStatus(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('shopify_automatic_pull_status', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error?.code === 'PGRST202') return { available: false, run: null }
  if (r.error) throw new Error('SHOPIFY_READ_FAILED')
  return { available: true, run: automaticPullStatus.nullable().parse(r.data) }
}

export async function runAutomaticShopifyPull(
  client: SupabaseClient,
  tenantId: string,
  env: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  const prepared = await client.rpc('prepare_shopify_automatic_pull', {
    p_tenant: tenantId,
  })
  if (prepared.error) throw new Error('SHOPIFY_PREPARE_FAILED')
  if (!prepared.data) return
  const run = job.parse(prepared.data)
  let outcome: 'received' | 'complete'
  try {
    const result = await pullShopifyOrders(
      client,
      { tenantId, requestId: run.id },
      env,
      http,
    )
    outcome =
      'received' in result && (result.received ?? 0) > 0
        ? 'received'
        : 'complete'
  } catch {
    await client.rpc('finish_shopify_automatic_pull', {
      p_tenant: tenantId,
      p_id: run.id,
      p_outcome: 'failed',
    })
    throw new Error('SHOPIFY_AUTOMATION_FAILED')
  }
  const finished = await client.rpc('finish_shopify_automatic_pull', {
    p_tenant: tenantId,
    p_id: run.id,
    p_outcome: outcome,
  })
  if (finished.error) throw new Error('SHOPIFY_AUTOMATION_FAILED')
}

export async function handleShopifyCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  makeClient: typeof createClient = createClient,
  run = runAutomaticShopifyPull,
) {
  const reply = (status: number, body: object) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  const identity = automationIdentity(env)
  const secret = env.CRON_SECRET
  if (
    env.KOMISIO_INTAKE_ENABLED !== 'true' ||
    !identity ||
    !secret ||
    secret.length < 16 ||
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return reply(404, { error: 'NOT_FOUND' })
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return reply(401, { error: 'AUTH_REQUIRED' })
  const client = makeClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )
  let failed = false
  try {
    const signed = await client.auth.signInWithPassword(identity)
    if (signed.error) throw new Error('AUTH_FAILED')
    await acceptAutomationGrants(client)
    const tenants = await client.rpc('shopify_automation_tenants')
    if (tenants.error) throw new Error('GRANTS_FAILED')
    const active = z.array(z.object({ tenantId: z.uuid() })).parse(tenants.data)
    for (const { tenantId } of active) {
      if (tenantId !== env.SHOPIFY_PILOT_TENANT_ID) continue
      try {
        await run(client, tenantId, env)
      } catch {
        failed = true
      }
    }
  } catch {
    failed = true
  } finally {
    try {
      const signedOut = await client.auth.signOut({ scope: 'local' })
      if (signedOut.error) failed = true
    } catch {
      failed = true
    }
  }
  return failed
    ? reply(500, { error: 'SHOPIFY_AUTOMATION_FAILED' })
    : reply(200, { ok: true })
}
