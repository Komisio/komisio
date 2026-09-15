import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { automationIdentity, acceptAutomationGrants } from './automation'
import { sendExportToFortnox } from './fortnox-vouchers'

const runStatus = z.object({
  at: z.string(),
  outcome: z.enum(['complete', 'partial', 'failed']),
  sent: z.number().int().min(0).max(100),
})

export async function readAutomaticFortnoxStatus(
  client: SupabaseClient,
  tenantId: string,
) {
  const result = await client.rpc('fortnox_automatic_status', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (result.error?.code === 'PGRST202') return { available: false, run: null }
  if (result.error) throw new Error('FORTNOX_READ_FAILED')
  return { available: true, run: runStatus.nullable().parse(result.data) }
}

export async function runAutomaticFortnoxSend(
  client: SupabaseClient,
  tenantId: string,
  env: Record<string, string | undefined>,
  send = sendExportToFortnox,
  now = Date.now,
) {
  z.uuid().parse(tenantId)
  if (tenantId !== env.FORTNOX_PILOT_TENANT_ID)
    throw new Error('FORTNOX_NOT_CONNECTED')
  const runId = randomUUID()
  const deadline = now() + 200000
  let sent = 0
  let outcome: 'complete' | 'partial' | 'failed' = 'complete'
  try {
    const result = await client.rpc('fortnox_automatic_exports', {
      p_tenant: tenantId,
    })
    if (result.error) throw new Error('FORTNOX_READ_FAILED')
    const exports = z
      .array(z.object({ exportId: z.uuid() }))
      .max(100)
      .parse(result.data)
    if (exports.length === 100) outcome = 'partial'
    for (const entry of exports) {
      if (now() >= deadline) {
        outcome = 'partial'
        break
      }
      const result = await send(
        client,
        tenantId,
        entry.exportId,
        randomUUID(),
        env,
      )
      if (result.status !== 'sent') throw new Error('FORTNOX_AUTOMATION_FAILED')
      sent++
    }
  } catch {
    outcome = 'failed'
  }
  const recorded = await client.rpc('finish_fortnox_automatic_run', {
    p_tenant: tenantId,
    p_id: runId,
    p_outcome: outcome,
    p_sent: sent,
  })
  if (recorded.error || outcome === 'failed')
    throw new Error('FORTNOX_AUTOMATION_FAILED')
}

export async function handleFortnoxCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  makeClient: typeof createClient = createClient,
  run = runAutomaticFortnoxSend,
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
    const tenants = await client.rpc('fortnox_automation_tenants')
    if (tenants.error) throw new Error('GRANTS_FAILED')
    const active = z.array(z.object({ tenantId: z.uuid() })).parse(tenants.data)
    for (const { tenantId } of active) {
      if (tenantId !== env.FORTNOX_PILOT_TENANT_ID) continue
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
      const result = await client.auth.signOut({ scope: 'local' })
      if (result.error) failed = true
    } catch {
      failed = true
    }
  }
  return failed
    ? reply(500, { error: 'FORTNOX_AUTOMATION_FAILED' })
    : reply(200, { ok: true })
}
