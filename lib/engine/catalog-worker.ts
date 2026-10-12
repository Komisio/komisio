import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { automationIdentity, acceptAutomationGrants } from './automation'
import { paypalEnvironment } from './paypal-credentials'
import { syncPayPalItem } from './paypal-sync'

const connection = z.object({
  tenantId: z.uuid(),
  provider: z.literal('paypal'),
})
const job = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  provider: z.literal('paypal'),
  connectionId: z.uuid(),
})

/** One new lease per invocation. Unknown claims are never executed a second time. */
export async function runAutomaticCatalogExport(
  client: SupabaseClient,
  target: z.infer<typeof connection>,
  env: Record<string, string | undefined>,
  resolve = paypalEnvironment,
  sync = syncPayPalItem,
) {
  const c = connection.parse(target)
  const claimed = await client.rpc('claim_catalog_export', {
    p_tenant: c.tenantId,
    p_id: randomUUID(),
    p_provider: c.provider,
  })
  if (claimed.error) throw new Error('CATALOG_CLAIM_FAILED')
  if (!claimed.data) return false
  const work = job.parse(claimed.data)
  let outcome: 'complete' | 'held' | 'failed' = 'failed'
  try {
    const source = await resolve(client, c.tenantId, env)
    if (
      source.ZETTLE_PILOT_TENANT_ID !== c.tenantId ||
      source.ZETTLE_MERCHANT_ID !== work.connectionId
    )
      throw new Error('SYNC_CONNECTION_CHANGED')
    const result = await sync(client, c.tenantId, work.id, work.itemId, source)
    outcome = result.stock === 'initialized' ? 'complete' : 'held'
  } catch {
    // Never persist or return provider payloads, credentials, or arbitrary exception text.
    outcome = 'failed'
  }
  const finished = await client.rpc('finish_catalog_export', {
    p_tenant: c.tenantId,
    p_id: work.id,
    p_outcome: outcome,
  })
  if (finished.error || outcome === 'failed')
    throw new Error('CATALOG_EXPORT_FAILED')
  return true
}

export async function handleCatalogCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  makeClient: typeof createClient = createClient,
  run = runAutomaticCatalogExport,
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
  const deadline = Date.now() + 180_000
  let failed = false
  try {
    const signed = await client.auth.signInWithPassword(identity)
    if (signed.error) throw new Error('AUTH_FAILED')
    await acceptAutomationGrants(client)
    const listed = await client.rpc('catalog_automation_connections')
    if (listed.error) throw new Error('GRANTS_FAILED')
    const active = z.array(connection).max(20).parse(listed.data)
    // Round-robin connections; bounded calls and runtime keep large stores from starving others.
    const queue = [...active]
    for (
      let count = 0;
      queue.length && count < 10 && Date.now() < deadline;
      count++
    ) {
      const next = queue.shift()!
      try {
        if (await run(client, next, env)) queue.push(next)
      } catch {
        failed = true
      }
    }
  } catch {
    failed = true
  } finally {
    try {
      if ((await client.auth.signOut({ scope: 'local' })).error) failed = true
    } catch {
      failed = true
    }
  }
  return failed
    ? reply(500, { error: 'CATALOG_AUTOMATION_FAILED' })
    : reply(200, { ok: true })
}
