import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { acceptAutomationGrants, automationIdentity } from './automation'

const date = z.iso.date().nullable()
const count = z.number().int().min(0).max(31)
const runResult = z.object({
  grantId: z.uuid(),
  from: date,
  through: date,
  checked: count,
  created: count,
  unchanged: count,
  skipped: count,
  outcome: z.enum(['complete', 'partial']),
})

export async function readAutomaticDayCloseStatus(
  client: SupabaseClient,
  tenantId: string,
) {
  const result = await client.rpc('day_close_automatic_status', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (result.error?.code === 'PGRST202') return { available: false, run: null }
  if (result.error) throw new Error('DAY_CLOSE_READ_FAILED')
  return {
    available: true,
    run: runResult.extend({ at: z.string() }).nullable().parse(result.data),
  }
}

export async function runAutomaticDayCloses(
  client: SupabaseClient,
  tenantId: string,
  runId = randomUUID(),
) {
  const result = await client.rpc('run_automatic_day_closes', {
    p_tenant: z.uuid().parse(tenantId),
    p_id: z.uuid().parse(runId),
  })
  if (result.error) throw new Error('DAY_CLOSE_AUTOMATION_FAILED')
  return runResult.parse(result.data)
}

// The worker authenticates as an ordinary scoped member. No service-role key.
export async function handleDayCloseCron(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  makeClient: typeof createClient = createClient,
  run = runAutomaticDayCloses,
  now = Date.now,
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
  const deadline = now() + 200000
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
  let interrupted = false
  let catchingUp = false
  let processed = 0
  try {
    const signed = await client.auth.signInWithPassword(identity)
    if (signed.error) throw new Error('AUTH_FAILED')
    await acceptAutomationGrants(client)
    const tenants = await client.rpc('day_close_automation_tenants')
    if (tenants.error) throw new Error('GRANTS_FAILED')
    const active = z
      .array(z.object({ tenantId: z.uuid() }))
      .max(200)
      .parse(tenants.data)
    catchingUp = active.length === 200
    for (const { tenantId } of active) {
      if (now() >= deadline) {
        interrupted = true
        break
      }
      try {
        const result = await run(client, tenantId)
        processed++
        if (result.outcome === 'partial') catchingUp = true
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
  if (failed) return reply(500, { error: 'DAY_CLOSE_AUTOMATION_FAILED' })
  if (interrupted)
    return reply(503, { error: 'DAY_CLOSE_AUTOMATION_INCOMPLETE', processed })
  return reply(200, { ok: true, processed, catchingUp })
}
